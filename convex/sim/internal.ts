import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { internalMutation } from "../_generated/server";
import { internal } from "../_generated/api";
import { v } from "convex/values";
import { PAUSE_BUDGET_CAP_SECONDS, PAUSE_BUDGET_REFRESH_MS } from "./economy/constants";
import {
  applyBackgroundTrade,
  deliverBackgroundTrade,
  spawnBackgroundTrade,
  setupBackgroundTradeNpcs,
} from "./economy/applyBackgroundTrade";
import { maybeAdjustAutomatedNpcTraderLimits } from "./economy/adjustAutomatedNpcTraderLimits";
import { applyNpcStrategy } from "./economy/applyNpcStrategy";
import { applyTurnEconomy } from "./economy/applyTurnEconomy";
import { loadGameSettings } from "./economy/gameSettings";
import {
  type BattleRoundResult,
  type CombatMultipliers,
  type CollateralDamageResult,
  type CollateralState,
  DEFENDER_BASE_MULTIPLIER,
  resolveFullCombatRound,
  resolveOpeningStrike,
} from "./combat";
import { insertSimEvent } from "./eventLog";
import { TRADER_EVENT_TYPES } from "./eventTypePolicies";
import { applyFleetMoveOrders, cleanupFleetOrdersForTurn } from "./fleetOrders";
import { applyGarrisonRoutes } from "./garrisonRoutes";
import { reconcileSystemHolding, resolveGameActorIdForEmpire } from "./systemHoldings";
import { POPULATION_MIN_INHABITED_PEOPLE } from "./economy/population";
import { findLinkBetweenSystems } from "../gal/linkUtils";
import { travelTurnsFromLinkCost } from "./fleetDispatch";
import { evaluateGameFinalization } from "./finalization";
import { recordGameTurnResolved } from "./helpers";
import {
  applyPreparationOperations,
  createStagedTurnContext,
  replacePreparationOperations,
} from "./stagedTurnStore";
import {
  deletePreparationOperations,
  invalidateOpenTurnPreparation,
} from "./turnPreparationInvalidation";
import {
  committedNextTurnStartedAt,
  scheduledNextTurnStartedAt,
  scheduledTurnPreparationAt,
  turnDurationHasElapsed,
} from "./turnTiming";
import { scheduleGameTurnWakeups } from "./wakeScheduler";
import {
  completedTraderVoyageHistoryTurnsToKeep,
  compareTurnResolutionPhases,
  economyTranscriptHistoryTurnsToKeep,
  FIRST_TURN_RESOLUTION_PHASE,
  gameUsesTraderEconomy,
  gameRunsResolutionPhase,
  liveEventHistoryTurnsToKeep,
  loadGameWithPersistedResolvedMode,
  nextTurnResolutionPhase,
  parseTurnResolutionPhase,
  resolutionPhasesBetween,
  type TurnResolutionPhase,
} from "./gameMode";

/** Max en-route fleet rows scanned for arrivals (indexed `by_gameId_and_status`). */
const MAX_ENROUTE_FLEETS_SCAN = 768;
/** Max idle fleet rows scanned for combat/merge passes (indexed). */
const MAX_IDLE_FLEETS_SCAN = 1024;
/** Keep only a small rolling window of turn-preparation metadata per running game. */
const PREPARATION_HISTORY_TURNS_TO_KEEP = 4;
const PREPARATION_OP_PRUNE_BATCH_SIZE = 256;
const PREPARATION_ROW_PRUNE_BATCH_SIZE = 64;
const EVENT_PRUNE_BATCH_SIZE = 256;
const ECONOMY_TRANSCRIPT_PRUNE_BATCH_SIZE = 256;
const LEGACY_TRADER_ROW_PRUNE_BATCH_SIZE = 256;
const TRADER_VOYAGE_PRUNE_BATCH_SIZE = 256;
const LEGACY_TRADER_EVENT_PRUNE_BATCH_SIZE = 128;

async function loadGameWithMissionModeHydrated(
  ctx: MutationCtx,
  gameId: Id<"sim_games">,
): Promise<Doc<"sim_games"> | null> {
  return await loadGameWithPersistedResolvedMode(ctx, gameId);
}

async function loadEnRouteFleetsForArrivals(
  ctx: MutationCtx,
  gameId: Id<"sim_games">,
  turnNumber: number,
): Promise<Doc<"flt_fleets">[]> {
  const candidates = await ctx.db
    .query("flt_fleets")
    .withIndex("by_gameId_and_status", (q) =>
      q.eq("gameId", gameId).eq("status", "enRoute"),
    )
    .take(MAX_ENROUTE_FLEETS_SCAN);

  return candidates.filter(
    (f) =>
      f.etaTurn === turnNumber &&
      f.destinationSystemId !== null,
  );
}

async function loadIdleFleetsForGame(
  ctx: MutationCtx,
  gameId: Id<"sim_games">,
): Promise<Doc<"flt_fleets">[]> {
  return await ctx.db
    .query("flt_fleets")
    .withIndex("by_gameId_and_status", (q) =>
      q.eq("gameId", gameId).eq("status", "idle"),
    )
    .take(MAX_IDLE_FLEETS_SCAN);
}

async function loadActiveBattleSystemIds(
  ctx: MutationCtx,
  gameId: Id<"sim_games">,
): Promise<Set<string>> {
  const battles = await ctx.db
    .query("cmb_battles")
    .withIndex("by_gameId_and_status", (q) =>
      q.eq("gameId", gameId).eq("status", "active"),
    )
    .take(128);
  return new Set(battles.map((battle) => battle.systemId as string));
}

const DEFAULT_COLLATERAL_STATE: CollateralState = {
  stockFood: 500,
  stockWeapons: 160,
  stockResearch: 120,
  /** Fallback headcount when system row has no population yet (~50M people). */
  population: 50_000_000,
};

function systemCollateralState(system: Doc<"gal_systems">): CollateralState {
  return {
    stockFood: system.stockFood ?? DEFAULT_COLLATERAL_STATE.stockFood,
    stockWeapons: system.stockWeapons ?? DEFAULT_COLLATERAL_STATE.stockWeapons,
    stockResearch: system.stockResearch ?? DEFAULT_COLLATERAL_STATE.stockResearch,
    population: system.population ?? DEFAULT_COLLATERAL_STATE.population,
  };
}

function collateralSummaryLabel(category: keyof CollateralState): string {
  switch (category) {
    case "stockFood":
      return "food";
    case "stockWeapons":
      return "weapons";
    case "stockResearch":
      return "research";
    case "population":
      return "population";
  }
}

async function refreshEmpirePauseBudgets(
  ctx: MutationCtx,
  gameId: Id<"sim_games">,
): Promise<void> {
  const now = Date.now();
  const empires = await ctx.db
    .query("emp_states")
    .withIndex("by_gameId", (q) => q.eq("gameId", gameId))
    .take(64);

  for (const empire of empires) {
    const last = empire.lastPauseRefreshAt ?? 0;
    if (now - last >= PAUSE_BUDGET_REFRESH_MS) {
      await ctx.db.patch("emp_states", empire._id, {
        pauseBudgetSeconds: PAUSE_BUDGET_CAP_SECONDS,
        lastPauseRefreshAt: now,
      });
    }
  }
}

async function finishGameIfSingleEmpireRemains(
  ctx: MutationCtx,
  gameId: Id<"sim_games">,
  turnNumber: number,
): Promise<Doc<"emp_states"> | null> {
  const empires = await ctx.db
    .query("emp_states")
    .withIndex("by_gameId", (q) => q.eq("gameId", gameId))
    .collect();
  const activeEmpires = empires.filter((empire) => !empire.isCollapsed);

  if (activeEmpires.length !== 1) {
    return null;
  }

  const winner = activeEmpires[0];
  const game = await ctx.db.get("sim_games", gameId);
  if (game === null || game.status === "finished") {
    return winner;
  }

  await ctx.db.patch("sim_games", gameId, {
    status: "finished",
    endedAt: Date.now(),
    winnerEmpireKey: winner.empireKey,
    finishReason: "last_empire_standing",
    finalizationState: "pending_result_write",
    turnPausedUntilMs: undefined,
    nextTurnAutoResolveDelayRatio: undefined,
  });

  const winnerGameActorId = await resolveGameActorIdForEmpire(ctx, {
    gameId,
    empireId: winner._id,
  });

  await ctx.db.insert("sim_events", {
    gameId,
    turnNumber,
    eventType: "game_finished",
    actorType: winnerGameActorId !== null ? "game_actor" : "empire",
    actorId: winnerGameActorId ?? winner._id,
    targetType: null,
    targetId: null,
    summary: `${winner.name} wins the game`,
    payload: JSON.stringify({
      winnerEmpireKey: winner.empireKey,
      ...(winnerGameActorId !== null ? { winnerGameActorId } : {}),
    }),
  });

  return winner;
}

async function decayRecentBattleDamage(
  ctx: MutationCtx,
  gameId: Id<"sim_games">,
): Promise<void> {
  const systems = await ctx.db
    .query("gal_systems")
    .withIndex("by_gameId", (q) => q.eq("gameId", gameId))
    .take(512);

  for (const system of systems) {
    const recentBattleTurns = Math.max(0, (system.recentBattleTurns ?? 0) - 1);
    const recentDamageFood = Math.floor((system.recentDamageFood ?? 0) * 0.85);
    const recentDamageWeapons = Math.floor((system.recentDamageWeapons ?? 0) * 0.85);
    const recentDamageResearch = Math.floor((system.recentDamageResearch ?? 0) * 0.85);
    const recentDamagePopulation = Math.floor(
      (system.recentDamagePopulation ?? 0) * 0.85,
    );

    if (
      recentBattleTurns === (system.recentBattleTurns ?? 0) &&
      recentDamageFood === (system.recentDamageFood ?? 0) &&
      recentDamageWeapons === (system.recentDamageWeapons ?? 0) &&
      recentDamageResearch === (system.recentDamageResearch ?? 0) &&
      recentDamagePopulation === (system.recentDamagePopulation ?? 0)
    ) {
      continue;
    }

    await ctx.db.patch("gal_systems", system._id, {
      recentBattleTurns,
      recentDamageFood,
      recentDamageWeapons,
      recentDamageResearch,
      recentDamagePopulation,
    });
  }
}

async function resolveFleetArrivals(
  ctx: MutationCtx,
  gameId: Id<"sim_games">,
  turnNumber: number,
): Promise<void> {
  const fleetsSnapshot = await loadEnRouteFleetsForArrivals(
    ctx,
    gameId,
    turnNumber,
  );

  for (const fleet of fleetsSnapshot) {
    const destId = fleet.destinationSystemId;
    if (destId === null) continue;

    await ctx.db.patch("flt_fleets", fleet._id, {
      originSystemId: destId,
      destinationSystemId: null,
      etaTurn: null,
      status: "idle",
    });
    await insertSimEvent(ctx, {
      gameId,
      turnNumber,
      eventType: "fleet_arrived",
      actorType: "fleet",
      actorId: fleet._id,
      targetType: "system",
      targetId: destId,
      summary: `${fleet.name} arrived`,
      payload: { fleetId: fleet._id, systemId: destId },
    });
  }
}

async function resolveColonyShipArrivals(
  ctx: MutationCtx,
  gameId: Id<"sim_games">,
  turnNumber: number,
): Promise<void> {
  const ships = await ctx.db
    .query("col_colony_ships")
    .withIndex("by_gameId_and_status", (q) =>
      q.eq("gameId", gameId).eq("status", "enRoute"),
    )
    .take(64);

  for (const ship of ships) {
    if (ship.etaTurn !== turnNumber || ship.destinationSystemId === null) continue;

    const destId = ship.destinationSystemId;
    const remaining = ship.routeRemainingSystemIds ?? [];

    if (remaining.length > 0) {
      const nextDest = remaining[0];
      const newRemaining = remaining.slice(1);
      const link = await findLinkBetweenSystems(ctx, gameId, destId, nextDest);
      if (link === null) {
        await ctx.db.patch("col_colony_ships", ship._id, {
          originSystemId: destId,
          destinationSystemId: null,
          etaTurn: null,
          status: "idle",
          dispatchedTurn: undefined,
          travelTurnsTotal: undefined,
          routeRemainingSystemIds: undefined,
        });
        await insertSimEvent(ctx, {
          gameId,
          turnNumber,
          eventType: "colony_ship_arrived",
          actorType: "colony_ship",
          actorId: ship._id,
          targetType: "system",
          targetId: destId,
          summary: `${ship.name} arrived (route broken — missing link)`,
          payload: { colonyShipId: ship._id, systemId: destId, routeError: true },
        });
        continue;
      }
      const turns = travelTurnsFromLinkCost(link.travelCost);
      const etaTurn = turnNumber + turns;
      await ctx.db.patch("col_colony_ships", ship._id, {
        originSystemId: destId,
        destinationSystemId: nextDest,
        etaTurn,
        status: "enRoute",
        dispatchedTurn: turnNumber,
        travelTurnsTotal: turns,
        routeRemainingSystemIds: newRemaining.length > 0 ? newRemaining : undefined,
      });
      await insertSimEvent(ctx, {
        gameId,
        turnNumber,
        eventType: "colony_ship_arrived",
        actorType: "colony_ship",
        actorId: ship._id,
        targetType: "system",
        targetId: destId,
        summary: `${ship.name} arrived — continuing toward next system`,
        payload: {
          colonyShipId: ship._id,
          systemId: destId,
          nextSystemId: nextDest,
          legComplete: true,
        },
      });
      continue;
    }

    await ctx.db.patch("col_colony_ships", ship._id, {
      originSystemId: destId,
      destinationSystemId: null,
      etaTurn: null,
      status: "idle",
      dispatchedTurn: undefined,
      travelTurnsTotal: undefined,
      routeRemainingSystemIds: undefined,
    });

    await insertSimEvent(ctx, {
      gameId,
      turnNumber,
      eventType: "colony_ship_arrived",
      actorType: "colony_ship",
      actorId: ship._id,
      targetType: "system",
      targetId: destId,
      summary: `${ship.name} arrived`,
      payload: { colonyShipId: ship._id, systemId: destId },
    });
  }
}

async function mergeIdleFleetsAtSameBody(
  ctx: MutationCtx,
  gameId: Id<"sim_games">,
  fleetIdsWithOrdersThisTurn: Set<string>,
): Promise<void> {
  const fleets = await loadIdleFleetsForGame(ctx, gameId);

  const idle = fleets.filter((f) => f.status === "idle");
  const groups = new Map<string, Doc<"flt_fleets">[]>();
  for (const fleet of idle) {
    const key = `${fleet.empireId}_${fleet.originSystemId}`;
    const list = groups.get(key) ?? [];
    list.push(fleet);
    groups.set(key, list);
  }

  for (const group of groups.values()) {
    if (group.length < 2) continue;
    if (group.some((f) => fleetIdsWithOrdersThisTurn.has(f._id))) continue;
    group.sort((a, b) => a._id.localeCompare(b._id));
    const keeper = group[0];
    let totalStrength = keeper.strength;
    for (let i = 1; i < group.length; i++) {
      totalStrength += group[i].strength;
      await ctx.db.delete("flt_fleets", group[i]._id);
    }
    await ctx.db.patch("flt_fleets", keeper._id, { strength: totalStrength });
  }
}

type FleetGroup = {
  empireId: Id<"emp_states">;
  fleets: Doc<"flt_fleets">[];
  ships: number;
};

function primaryFleetForGroup(group: FleetGroup): Doc<"flt_fleets"> | null {
  const ordered = [...group.fleets].sort(
    (left, right) => right.strength - left.strength || left._id.localeCompare(right._id),
  );
  return ordered[0] ?? null;
}

function primaryGameActorIdForGroup(group: FleetGroup): Id<"sim_game_actors"> | null {
  return primaryFleetForGroup(group)?.gameActorId ?? null;
}

function uniqueGameActorIdsForParticipants(
  participants: BattleParticipant[],
): Id<"sim_game_actors">[] {
  return Array.from(
    new Set(
      participants
        .map((participant) => participant.fleet.gameActorId ?? null)
        .filter((actorId): actorId is Id<"sim_game_actors"> => actorId !== null),
    ),
  );
}

const MOTHERSHIP_DEFENSE_SHIPS = 50;

type BattleSideRole = "attacker" | "defender";

type MothershipDamageEvent = {
  side: BattleSideRole;
  colonyShipId: Id<"col_colony_ships">;
  name: string;
  empireId: Id<"emp_states">;
  damageApplied: number;
  damageBefore: number;
  damageAfter: number;
  destroyed: boolean;
};

function groupIdleFleetsByEmpire(fleets: Doc<"flt_fleets">[]): FleetGroup[] {
  const byEmpire = new Map<string, FleetGroup>();
  for (const fleet of fleets) {
    if (fleet.status !== "idle" || fleet.strength <= 0) continue;
    const existing = byEmpire.get(fleet.empireId);
    if (existing === undefined) {
      byEmpire.set(fleet.empireId, {
        empireId: fleet.empireId,
        fleets: [fleet],
        ships: fleet.strength,
      });
    } else {
      existing.fleets.push(fleet);
      existing.ships += fleet.strength;
    }
  }
  return Array.from(byEmpire.values());
}

function chooseDefender(
  groups: FleetGroup[],
  ownerEmpireId: Id<"emp_states"> | null,
): FleetGroup {
  const ownerGroup =
    ownerEmpireId === null
      ? undefined
      : groups.find((group) => group.empireId === ownerEmpireId);
  if (ownerGroup !== undefined) return ownerGroup;
  return [...groups].sort((a, b) => b.ships - a.ships)[0];
}

type BattleParticipant = {
  empireId: Id<"emp_states">;
  fleet: Doc<"flt_fleets">;
  ships: number;
};

function primaryAttacker(
  attackers: BattleParticipant[],
): BattleParticipant | undefined {
  return [...attackers].sort(
    (a, b) => b.ships - a.ships || a.fleet._id.localeCompare(b.fleet._id),
  )[0];
}

function battleAttackerFleetIds(battle: Doc<"cmb_battles">): Id<"flt_fleets">[] {
  return battle.attackerFleetIds ?? [battle.attackerFleetId];
}

function battleDefenderFleetIds(battle: Doc<"cmb_battles">): Id<"flt_fleets">[] {
  return battle.defenderFleetIds ?? [battle.defenderFleetId];
}

function uniqueFleetIds(ids: Id<"flt_fleets">[]): Id<"flt_fleets">[] {
  return Array.from(new Set(ids));
}

function participantFromFleet(fleet: Doc<"flt_fleets">): BattleParticipant {
  return {
    empireId: fleet.empireId,
    fleet,
    ships: Math.max(0, Math.floor(fleet.strength)),
  };
}

async function loadBattleParticipants(
  ctx: MutationCtx,
  battle: Doc<"cmb_battles">,
): Promise<{ attackers: BattleParticipant[]; defender: BattleParticipant } | null> {
  const attackers: BattleParticipant[] = [];
  for (const fleetId of uniqueFleetIds(battleAttackerFleetIds(battle))) {
    const fleet = await ctx.db.get("flt_fleets", fleetId);
    if (fleet !== null && fleet.strength > 0) {
      attackers.push(participantFromFleet(fleet));
    }
  }

  const defenderFleetId = uniqueFleetIds(battleDefenderFleetIds(battle))[0];
  if (defenderFleetId === undefined) return null;
  const defenderFleet = await ctx.db.get("flt_fleets", defenderFleetId);
  if (defenderFleet === null || defenderFleet.strength <= 0) {
    return null;
  }

  return {
    attackers,
    defender: participantFromFleet(defenderFleet),
  };
}

function participantFleetGroup(participant: BattleParticipant): FleetGroup {
  return {
    empireId: participant.empireId,
    fleets: [participant.fleet],
    ships: participant.ships,
  };
}

function aggregateAttackerFleetGroup(attackers: BattleParticipant[]): FleetGroup {
  const primary = primaryAttacker(attackers);
  if (primary === undefined) {
    throw new Error("Cannot aggregate an empty attacker side.");
  }
  return {
    empireId: primary.empireId,
    fleets: attackers.map((attacker) => attacker.fleet),
    ships: attackers.reduce((sum, attacker) => sum + attacker.ships, 0),
  };
}

function allocateLossesByShips(
  participants: BattleParticipant[],
  incomingLosses: number,
): Map<string, number> {
  const losses = new Map<string, number>();
  const totalShips = participants.reduce((sum, participant) => sum + participant.ships, 0);
  const totalLosses = Math.max(
    0,
    Math.min(Math.floor(incomingLosses), totalShips),
  );
  if (totalShips <= 0 || totalLosses <= 0) return losses;

  const shares = participants.map((participant) => {
    const exact = (totalLosses * participant.ships) / totalShips;
    const base = Math.min(participant.ships, Math.floor(exact));
    return {
      participant,
      base,
      remainder: exact - base,
    };
  });

  let allocated = shares.reduce((sum, share) => sum + share.base, 0);
  for (const share of shares) {
    losses.set(share.participant.fleet._id, share.base);
  }

  const byRemainder = [...shares].sort(
    (a, b) =>
      b.remainder - a.remainder ||
      b.participant.ships - a.participant.ships ||
      a.participant.fleet._id.localeCompare(b.participant.fleet._id),
  );
  for (const share of byRemainder) {
    if (allocated >= totalLosses) break;
    const current = losses.get(share.participant.fleet._id) ?? 0;
    if (current >= share.participant.ships) continue;
    losses.set(share.participant.fleet._id, current + 1);
    allocated += 1;
  }

  return losses;
}

async function patchBattleParticipants(
  ctx: MutationCtx,
  battle: Doc<"cmb_battles">,
  params: {
    attackers: BattleParticipant[];
    defender: BattleParticipant;
    phase: Doc<"cmb_battles">["phase"];
    roundNumber: number;
    updatedTurn: number;
  },
): Promise<void> {
  const primary = primaryAttacker(params.attackers);
  if (primary === undefined) {
    throw new Error("Cannot patch a battle with no attackers.");
  }

  await ctx.db.patch("cmb_battles", battle._id, {
    attackerEmpireId: primary.empireId,
    attackerFleetId: primary.fleet._id,
    attackerFleetIds: params.attackers.map((attacker) => attacker.fleet._id),
    defenderEmpireId: params.defender.empireId,
    defenderFleetId: params.defender.fleet._id,
    defenderFleetIds: [params.defender.fleet._id],
    phase: params.phase,
    roundNumber: params.roundNumber,
    updatedTurn: params.updatedTurn,
  });
}

async function loadIdleMothershipTargets(
  ctx: MutationCtx,
  params: {
    gameId: Id<"sim_games">;
    systemId: Id<"gal_systems">;
    empireId: Id<"emp_states">;
    gameActorId?: Id<"sim_game_actors"> | null;
  },
): Promise<Doc<"col_colony_ships">[]> {
  const ships = await ctx.db
    .query("col_colony_ships")
    .withIndex("by_gameId_and_originSystemId_and_status", (q) =>
      q
        .eq("gameId", params.gameId)
        .eq("originSystemId", params.systemId)
        .eq("status", "idle"),
    )
    .take(32);
  return ships
    .filter((ship) =>
      params.gameActorId !== undefined && params.gameActorId !== null
        ? ship.gameActorId === params.gameActorId
        : ship.empireId === params.empireId,
    )
    .sort((a, b) => a._id.localeCompare(b._id));
}

async function applyMothershipPriorityDamage(
  ctx: MutationCtx,
  params: {
    gameId: Id<"sim_games">;
    systemId: Id<"gal_systems">;
    empireId: Id<"emp_states">;
    side: BattleSideRole;
    incomingLosses: number;
  },
): Promise<{ fleetLosses: number; events: MothershipDamageEvent[] }> {
  let remainingDamage = Math.max(0, Math.floor(params.incomingLosses));
  const events: MothershipDamageEvent[] = [];
  if (remainingDamage <= 0) {
    return { fleetLosses: 0, events };
  }

  const targets = await loadIdleMothershipTargets(ctx, params);
  for (const target of targets) {
    if (remainingDamage <= 0) break;
    const damageBefore = Math.max(0, Math.floor(target.mothershipDefenseDamage ?? 0));
    const defenseRemaining = Math.max(0, MOTHERSHIP_DEFENSE_SHIPS - damageBefore);
    if (defenseRemaining <= 0) {
      await ctx.db.delete("col_colony_ships", target._id);
      events.push({
        side: params.side,
        colonyShipId: target._id,
        name: target.name,
        empireId: target.empireId,
        damageApplied: 0,
        damageBefore,
        damageAfter: MOTHERSHIP_DEFENSE_SHIPS,
        destroyed: true,
      });
      continue;
    }

    const damageApplied = Math.min(remainingDamage, defenseRemaining);
    const damageAfter = damageBefore + damageApplied;
    const destroyed = damageAfter >= MOTHERSHIP_DEFENSE_SHIPS;
    remainingDamage -= damageApplied;

    if (destroyed) {
      await ctx.db.delete("col_colony_ships", target._id);
    } else {
      await ctx.db.patch("col_colony_ships", target._id, {
        mothershipDefenseDamage: damageAfter,
      });
    }

    events.push({
      side: params.side,
      colonyShipId: target._id,
      name: target.name,
      empireId: target.empireId,
      damageApplied,
      damageBefore,
      damageAfter,
      destroyed,
    });
  }

  return { fleetLosses: remainingDamage, events };
}

async function applyMultiAttackerMothershipPriorityToRound(
  ctx: MutationCtx,
  params: {
    gameId: Id<"sim_games">;
    systemId: Id<"gal_systems">;
    attackers: BattleParticipant[];
    defender: BattleParticipant;
    round: BattleRoundResult;
  },
): Promise<{
  round: BattleRoundResult;
  attackerLossesByFleetId: Map<string, number>;
  defenderLosses: number;
  events: MothershipDamageEvent[];
}> {
  const attackerIncomingLosses = allocateLossesByShips(
    params.attackers,
    params.round.attackerLosses,
  );
  const attackerLossesByFleetId = new Map<string, number>();
  const events: MothershipDamageEvent[] = [];
  let attackerLosses = 0;

  for (const attacker of params.attackers) {
    const incomingLosses = attackerIncomingLosses.get(attacker.fleet._id) ?? 0;
    const damage = await applyMothershipPriorityDamage(ctx, {
      gameId: params.gameId,
      systemId: params.systemId,
      empireId: attacker.empireId,
      side: "attacker",
      incomingLosses,
    });
    const fleetLosses = Math.min(attacker.ships, damage.fleetLosses);
    attackerLossesByFleetId.set(attacker.fleet._id, fleetLosses);
    attackerLosses += fleetLosses;
    events.push(...damage.events);
  }

  const defenderDamage = await applyMothershipPriorityDamage(ctx, {
    gameId: params.gameId,
    systemId: params.systemId,
    empireId: params.defender.empireId,
    side: "defender",
    incomingLosses: params.round.defenderLosses,
  });
  const defenderLosses = Math.min(params.defender.ships, defenderDamage.fleetLosses);
  events.push(...defenderDamage.events);

  return {
    round: {
      ...params.round,
      attackerLosses,
      defenderLosses,
      attackerShipsAfter: params.round.attackerShipsBefore - attackerLosses,
      defenderShipsAfter: params.round.defenderShipsBefore - defenderLosses,
    },
    attackerLossesByFleetId,
    defenderLosses,
    events,
  };
}

async function applyParticipantLosses(
  ctx: MutationCtx,
  participants: BattleParticipant[],
  lossesByFleetId: Map<string, number>,
): Promise<BattleParticipant[]> {
  const survivors: BattleParticipant[] = [];
  for (const participant of participants) {
    const losses = Math.max(0, lossesByFleetId.get(participant.fleet._id) ?? 0);
    const ships = Math.max(0, participant.ships - losses);
    if (ships <= 0) {
      await ctx.db.delete("flt_fleets", participant.fleet._id);
      continue;
    }
    await ctx.db.patch("flt_fleets", participant.fleet._id, { strength: ships });
    survivors.push({
      ...participant,
      fleet: { ...participant.fleet, strength: ships },
      ships,
    });
  }
  return survivors;
}

async function writeFleetGroupStrength(
  ctx: MutationCtx,
  group: FleetGroup,
  shipsRemaining: number,
): Promise<void> {
  const ships = Math.max(0, Math.floor(shipsRemaining));
  const fleets = [...group.fleets].sort((a, b) => a._id.localeCompare(b._id));
  if (ships <= 0) {
    for (const fleet of fleets) {
      await ctx.db.delete("flt_fleets", fleet._id);
    }
    group.fleets = [];
    group.ships = 0;
    return;
  }

  const [keeper, ...rest] = fleets;
  await ctx.db.patch("flt_fleets", keeper._id, { strength: ships, status: "idle" });
  for (const fleet of rest) {
    await ctx.db.delete("flt_fleets", fleet._id);
  }
  group.fleets = [keeper];
  group.ships = ships;
}

async function loadIdleFleetsAtSystem(
  ctx: MutationCtx,
  params: {
    gameId: Id<"sim_games">;
    systemId: Id<"gal_systems">;
  },
): Promise<Doc<"flt_fleets">[]> {
  const idle = await loadIdleFleetsForGame(ctx, params.gameId);
  return idle.filter(
    (fleet) => fleet.originSystemId === params.systemId && fleet.strength > 0,
  );
}

async function absorbIdleGroupIntoParticipant(
  ctx: MutationCtx,
  params: {
    gameId: Id<"sim_games">;
    turnNumber: number;
    systemId: Id<"gal_systems">;
    battleId: Id<"cmb_battles">;
    systemName: string;
    side: BattleSideRole;
    participant: BattleParticipant;
    idleGroup: FleetGroup;
  },
): Promise<BattleParticipant> {
  const reinforcementShips = params.idleGroup.ships;
  for (const fleet of params.idleGroup.fleets) {
    await ctx.db.delete("flt_fleets", fleet._id);
  }

  const strength = params.participant.ships + reinforcementShips;
  await ctx.db.patch("flt_fleets", params.participant.fleet._id, { strength });
  const participantGameActorId = params.participant.fleet.gameActorId ?? null;
  await insertSimEvent(ctx, {
    gameId: params.gameId,
    turnNumber: params.turnNumber,
    eventType: "battle_reinforced",
    actorType: participantGameActorId !== null ? "game_actor" : "empire",
    actorId: participantGameActorId ?? params.participant.empireId,
    targetType: "system",
    targetId: params.systemId,
    summary: `${params.systemName}: ${reinforcementShips} ${params.side} reinforcement ships joined the battle`,
    payload: {
      battleId: params.battleId,
      systemId: params.systemId,
      empireId: params.participant.empireId,
      side: params.side,
      reinforcementShips,
      mergedFleetCount: params.idleGroup.fleets.length,
      battleFleetId: params.participant.fleet._id,
    },
  });

  const updated = await ctx.db.get("flt_fleets", params.participant.fleet._id);
  if (updated === null) {
    throw new Error("Battle fleet disappeared while absorbing reinforcements.");
  }
  return participantFromFleet(updated);
}

async function addIdleFleetsToActiveBattle(
  ctx: MutationCtx,
  params: {
    gameId: Id<"sim_games">;
    turnNumber: number;
    battle: Doc<"cmb_battles">;
    system: Doc<"gal_systems">;
    attackers: BattleParticipant[];
    defender: BattleParticipant;
  },
): Promise<{ attackers: BattleParticipant[]; defender: BattleParticipant }> {
  const idleGroups = groupIdleFleetsByEmpire(
    await loadIdleFleetsAtSystem(ctx, {
      gameId: params.gameId,
      systemId: params.system._id,
    }),
  );

  let attackers = [...params.attackers];
  let defender = params.defender;

  for (const idleGroup of idleGroups) {
    if (idleGroup.empireId === defender.empireId) {
      defender = await absorbIdleGroupIntoParticipant(ctx, {
        gameId: params.gameId,
        turnNumber: params.turnNumber,
        systemId: params.system._id,
        battleId: params.battle._id,
        systemName: params.system.name,
        side: "defender",
        participant: defender,
        idleGroup,
      });
      continue;
    }

    const existingAttackerIndex = attackers.findIndex(
      (attacker) => attacker.empireId === idleGroup.empireId,
    );
    if (existingAttackerIndex >= 0) {
      const existing = attackers[existingAttackerIndex];
      if (existing === undefined) continue;
      const updated = await absorbIdleGroupIntoParticipant(ctx, {
        gameId: params.gameId,
        turnNumber: params.turnNumber,
        systemId: params.system._id,
        battleId: params.battle._id,
        systemName: params.system.name,
        side: "attacker",
        participant: existing,
        idleGroup,
      });
      attackers = attackers.map((attacker, index) =>
        index === existingAttackerIndex ? updated : attacker,
      );
      continue;
    }

    const fleet = await mergeFleetGroupForBattle(ctx, idleGroup);
    await ctx.db.patch("flt_fleets", fleet._id, {
      status: "engaged",
      activeBattleId: params.battle._id,
    });
    attackers.push(participantFromFleet({ ...fleet, status: "engaged" }));
    const idleGroupGameActorId = primaryGameActorIdForGroup(idleGroup);
    await insertSimEvent(ctx, {
      gameId: params.gameId,
      turnNumber: params.turnNumber,
      eventType: "battle_reinforced",
      actorType: idleGroupGameActorId !== null ? "game_actor" : "empire",
      actorId: idleGroupGameActorId ?? idleGroup.empireId,
      targetType: "system",
      targetId: params.system._id,
      summary: `${params.system.name}: ${idleGroup.ships} third-party attacking ships joined the battle`,
      payload: {
        battleId: params.battle._id,
        systemId: params.system._id,
        empireId: idleGroup.empireId,
        side: "attacker",
        reinforcementShips: idleGroup.ships,
        mergedFleetCount: idleGroup.fleets.length,
        battleFleetId: fleet._id,
      },
    });
  }

  if (attackers.length > 0) {
    await patchBattleParticipants(ctx, params.battle, {
      attackers,
      defender,
      phase: params.battle.phase,
      roundNumber: params.battle.roundNumber,
      updatedTurn: params.turnNumber,
    });
  }

  return { attackers, defender };
}

function damageTotals(collateral: CollateralDamageResult[]) {
  return collateral.reduce(
    (totals, damage) => {
      totals[damage.category] += damage.amount;
      return totals;
    },
    {
      stockFood: 0,
      stockWeapons: 0,
      stockResearch: 0,
      population: 0,
    } satisfies CollateralState,
  );
}

async function patchSystemDamage(
  ctx: MutationCtx,
  system: Doc<"gal_systems">,
  state: CollateralState,
  collateral: CollateralDamageResult[],
): Promise<Doc<"gal_systems">> {
  if (collateral.length === 0) {
    return system;
  }

  const totals = damageTotals(collateral);
  await ctx.db.patch("gal_systems", system._id, {
    stockFood: state.stockFood,
    stockWeapons: state.stockWeapons,
    stockResearch: state.stockResearch,
    population: state.population,
    recentBattleTurns: 3,
    recentDamageFood: (system.recentDamageFood ?? 0) + totals.stockFood,
    recentDamageWeapons: (system.recentDamageWeapons ?? 0) + totals.stockWeapons,
    recentDamageResearch: (system.recentDamageResearch ?? 0) + totals.stockResearch,
    recentDamagePopulation:
      (system.recentDamagePopulation ?? 0) + totals.population,
  });

  const updated = await ctx.db.get("gal_systems", system._id);
  if (updated === null) {
    throw new Error("System disappeared during combat resolution.");
  }
  return updated;
}

async function writeBattleRoundEvents(
  ctx: MutationCtx,
  params: {
    gameId: Id<"sim_games">;
    turnNumber: number;
    battleId: Id<"cmb_battles">;
    system: Doc<"gal_systems">;
    attacker: FleetGroup;
    defender: FleetGroup;
    rounds: BattleRoundResult[];
    mothershipEvents?: MothershipDamageEvent[];
  },
): Promise<void> {
  const attackerGameActorId = primaryGameActorIdForGroup(params.attacker);
  for (const round of params.rounds) {
    const mothershipEvents = params.mothershipEvents ?? [];
    const destroyedMotherships = mothershipEvents.filter((event) => event.destroyed);
    await insertSimEvent(ctx, {
      gameId: params.gameId,
      turnNumber: params.turnNumber,
      eventType: "battle_round_resolved",
      actorType: attackerGameActorId !== null ? "game_actor" : "empire",
      actorId: attackerGameActorId ?? params.attacker.empireId,
      targetType: "system",
      targetId: params.system._id,
      summary:
        (round.phase === "opening"
          ? `${params.system.name}: defenders destroyed ${round.attackerLosses} attacking ships in the opening strike`
          : `${params.system.name}: round ${round.roundNumber} destroyed ${round.attackerLosses} attacker and ${round.defenderLosses} defender ships`) +
        (destroyedMotherships.length > 0
          ? `; ${destroyedMotherships.length} mothership${destroyedMotherships.length === 1 ? "" : "s"} destroyed`
          : ""),
      payload: {
        battleId: params.battleId,
        systemId: params.system._id,
        attackerEmpireId: params.attacker.empireId,
        ...(attackerGameActorId !== null ? { attackerGameActorId } : {}),
        defenderEmpireId: params.defender.empireId,
        ...(primaryGameActorIdForGroup(params.defender) !== null
          ? { defenderGameActorId: primaryGameActorIdForGroup(params.defender) }
          : {}),
        mothershipEvents,
        ...round,
      },
    });
  }
}

async function writeCollateralEvents(
  ctx: MutationCtx,
  params: {
    gameId: Id<"sim_games">;
    turnNumber: number;
    system: Doc<"gal_systems">;
    damage: CollateralDamageResult[];
  },
): Promise<void> {
  for (const damage of params.damage) {
    const label = collateralSummaryLabel(damage.category);
    await insertSimEvent(ctx, {
      gameId: params.gameId,
      turnNumber: params.turnNumber,
      eventType: "collateral_damage_applied",
      actorType: "system",
      actorId: params.system._id,
      targetType: "system",
      targetId: params.system._id,
      summary: `${params.system.name}: battle damaged ${damage.amount} ${label}`,
      payload: {
        systemId: params.system._id,
        ...damage,
      },
    });
  }
}

async function mergeFleetGroupForBattle(
  ctx: MutationCtx,
  group: FleetGroup,
): Promise<Doc<"flt_fleets">> {
  await writeFleetGroupStrength(ctx, group, group.ships);
  const fleet = group.fleets[0];
  if (fleet === undefined) {
    throw new Error("Cannot start a battle with no fleet.");
  }
  const updated = await ctx.db.get("flt_fleets", fleet._id);
  if (updated === null) {
    throw new Error("Battle fleet disappeared during merge.");
  }
  return updated;
}

async function finishBattle(
  ctx: MutationCtx,
  params: {
    battle: Doc<"cmb_battles">;
    system: Doc<"gal_systems">;
    eventTurn: number;
    winnerEmpireId: Id<"emp_states"> | null;
    winnerGameActorId?: Id<"sim_game_actors">;
    winnerFleetId: Id<"flt_fleets"> | null;
    eventType: "system_conquered" | "system_held";
    summary: string;
    payload: Record<string, unknown>;
  },
): Promise<void> {
  const resolvedWinnerGameActorId =
    params.winnerEmpireId === null
      ? null
      : params.winnerGameActorId ??
        (await resolveGameActorIdForEmpire(ctx, {
          gameId: params.battle.gameId,
          empireId: params.winnerEmpireId,
        }));
  await ctx.db.patch("cmb_battles", params.battle._id, {
    status: "resolved",
    phase: "resolved",
    updatedTurn: params.eventTurn,
  });

  const conquered =
    params.winnerEmpireId !== null &&
    params.eventType === "system_conquered" &&
    params.system.ownerEmpireId !== params.winnerEmpireId;

  if (params.winnerEmpireId !== null) {
    const ownerPatch: Partial<Doc<"gal_systems">> = {
      ownerEmpireId: params.winnerEmpireId,
      ownerGameActorId: resolvedWinnerGameActorId ?? undefined,
      underAttack: false,
      recentBattleTurns: Math.max(params.system.recentBattleTurns ?? 0, 3),
    };
    if (conquered) {
      ownerPatch.taxBlockedUntilTurn = params.eventTurn + 1;
      await reconcileSystemHolding(ctx, {
        gameId: params.battle.gameId,
        systemId: params.system._id,
        winnerEmpireId: params.winnerEmpireId,
        ...(resolvedWinnerGameActorId !== null
          ? { winnerGameActorId: resolvedWinnerGameActorId }
          : {}),
      });
    } else {
      ownerPatch.underAttack = false;
    }
    await ctx.db.patch("gal_systems", params.system._id, ownerPatch);
  } else {
    await ctx.db.patch("gal_systems", params.system._id, { underAttack: false });
  }

  if (params.winnerFleetId !== null) {
    const winnerFleet = await ctx.db.get("flt_fleets", params.winnerFleetId);
    if (winnerFleet !== null && winnerFleet.status === "engaged") {
      await ctx.db.patch("flt_fleets", winnerFleet._id, { status: "idle" });
    }
  }

  await insertSimEvent(ctx, {
    gameId: params.battle.gameId,
    turnNumber: params.eventTurn,
    eventType: params.eventType,
    actorType:
      params.winnerEmpireId === null
        ? "system"
        : resolvedWinnerGameActorId !== null
          ? "game_actor"
          : "empire",
    actorId:
      params.winnerEmpireId === null
        ? params.system._id
        : resolvedWinnerGameActorId ?? params.winnerEmpireId,
    targetType: "system",
    targetId: params.system._id,
    summary: params.summary,
    payload: {
      battleId: params.battle._id,
      systemId: params.system._id,
      ...params.payload,
    },
  });
}

async function continueBattleWithNewDefender(
  ctx: MutationCtx,
  params: {
    battle: Doc<"cmb_battles">;
    system: Doc<"gal_systems">;
    eventTurn: number;
    attackers: BattleParticipant[];
    newDefender: BattleParticipant;
    roundNumber: number;
  },
): Promise<void> {
  const newDefenderGameActorId =
    params.newDefender.fleet.gameActorId ??
    (await resolveGameActorIdForEmpire(ctx, {
      gameId: params.battle.gameId,
      empireId: params.newDefender.empireId,
    }));
  await ctx.db.patch("gal_systems", params.system._id, {
    ownerEmpireId: params.newDefender.empireId,
    ownerGameActorId: newDefenderGameActorId ?? undefined,
    underAttack: true,
    lastContestedTurn: params.eventTurn,
    taxBlockedUntilTurn: params.eventTurn + 1,
    recentBattleTurns: Math.max(params.system.recentBattleTurns ?? 0, 3),
  });
  await reconcileSystemHolding(ctx, {
    gameId: params.battle.gameId,
    systemId: params.system._id,
    winnerEmpireId: params.newDefender.empireId,
    ...(newDefenderGameActorId !== null ? { winnerGameActorId: newDefenderGameActorId } : {}),
  });

  await patchBattleParticipants(ctx, params.battle, {
    attackers: params.attackers,
    defender: params.newDefender,
    phase: "awaitingAttackerDecision",
    roundNumber: params.roundNumber,
    updatedTurn: params.eventTurn,
  });

  await insertSimEvent(ctx, {
    gameId: params.battle.gameId,
    turnNumber: params.eventTurn,
    eventType: "battle_defender_changed",
    actorType: params.newDefender.fleet.gameActorId !== undefined ? "game_actor" : "empire",
    actorId: params.newDefender.fleet.gameActorId ?? params.newDefender.empireId,
    targetType: "system",
    targetId: params.system._id,
    summary: `${params.system.name}: the strongest surviving attacker became the new defender`,
    payload: {
      battleId: params.battle._id,
      systemId: params.system._id,
      defenderEmpireId: params.newDefender.empireId,
      ...(params.newDefender.fleet.gameActorId !== undefined
        ? { defenderGameActorId: params.newDefender.fleet.gameActorId }
        : {}),
      defenderFleetId: params.newDefender.fleet._id,
      survivingShips: params.newDefender.ships,
      attackerEmpireIds: params.attackers.map((attacker) => attacker.empireId),
      ...(uniqueGameActorIdsForParticipants(params.attackers).length > 0
        ? { attackerGameActorIds: uniqueGameActorIdsForParticipants(params.attackers) }
        : {}),
      attackerFleetIds: params.attackers.map((attacker) => attacker.fleet._id),
    },
  });
}

async function resolveActiveBattles(
  ctx: MutationCtx,
  params: {
    gameId: Id<"sim_games">;
    turnNumber: number;
    seed: string;
    orders: Doc<"flt_orders">[];
    combatMultipliers: CombatMultipliers;
  },
): Promise<void> {
  const battles = await ctx.db
    .query("cmb_battles")
    .withIndex("by_gameId_and_status", (q) =>
      q.eq("gameId", params.gameId).eq("status", "active"),
    )
    .take(64);
  for (const battle of battles) {
    let system = await ctx.db.get("gal_systems", battle.systemId);
    const loaded = await loadBattleParticipants(ctx, battle);
    if (system === null || loaded === null || loaded.attackers.length === 0) {
      for (const fleetId of [
        ...battleAttackerFleetIds(battle),
        ...battleDefenderFleetIds(battle),
      ]) {
        const fleet = await ctx.db.get("flt_fleets", fleetId);
        if (fleet !== null && fleet.status === "engaged") {
          await ctx.db.patch("flt_fleets", fleet._id, { status: "idle" });
        }
      }
      await ctx.db.patch("cmb_battles", battle._id, {
        status: "resolved",
        phase: "resolved",
        updatedTurn: params.turnNumber,
      });
      continue;
    }

    const withArrivals = await addIdleFleetsToActiveBattle(ctx, {
      gameId: params.gameId,
      turnNumber: params.turnNumber,
      battle,
      system,
      attackers: loaded.attackers,
      defender: loaded.defender,
    });
    const attackers = withArrivals.attackers;
    const defender = withArrivals.defender;
    const attackerShips = attackers.reduce((sum, attacker) => sum + attacker.ships, 0);
    if (attackerShips <= 0) continue;

    const isDefenderHomeworld =
      system.isHomeworld && system.ownerEmpireId === defender.empireId;
    const currentPrimaryAttacker = primaryAttacker(attackers);
    if (currentPrimaryAttacker === undefined) continue;

    const fullRound = resolveFullCombatRound({
      attackerShips,
      defenderShips: defender.ships,
      seed: params.seed,
      systemId: system._id,
      turnNumber: params.turnNumber,
      attackerEmpireId: currentPrimaryAttacker.empireId,
      defenderEmpireId: defender.empireId,
      roundNumber: battle.roundNumber + 1,
      isDefenderHomeworld,
      collateralState: systemCollateralState(system),
      multipliers: params.combatMultipliers,
    });
    const adjusted = await applyMultiAttackerMothershipPriorityToRound(ctx, {
      gameId: params.gameId,
      systemId: system._id,
      attackers,
      defender,
      round: fullRound.round,
    });
    const round = adjusted.round;

    await writeBattleRoundEvents(ctx, {
      gameId: params.gameId,
      turnNumber: params.turnNumber,
      battleId: battle._id,
      system,
      attacker: aggregateAttackerFleetGroup(attackers),
      defender: participantFleetGroup(defender),
      rounds: [round],
      mothershipEvents: adjusted.events,
    });
    await writeCollateralEvents(ctx, {
      gameId: params.gameId,
      turnNumber: params.turnNumber,
      system,
      damage: fullRound.collateral,
    });
    system = await patchSystemDamage(
      ctx,
      system,
      fullRound.collateralState,
      fullRound.collateral,
    );

    const survivingAttackers = await applyParticipantLosses(
      ctx,
      attackers,
      adjusted.attackerLossesByFleetId,
    );

    let survivingDefender: BattleParticipant | null = null;
    if (round.defenderShipsAfter <= 0 || adjusted.defenderLosses >= defender.ships) {
      await ctx.db.delete("flt_fleets", defender.fleet._id);
    } else {
      await ctx.db.patch("flt_fleets", defender.fleet._id, {
        strength: round.defenderShipsAfter,
      });
      survivingDefender = {
        ...defender,
        fleet: { ...defender.fleet, strength: round.defenderShipsAfter },
        ships: round.defenderShipsAfter,
      };
    }

    if (survivingAttackers.length > 0 && survivingDefender === null) {
      if (survivingAttackers.length === 1) {
        const winner = survivingAttackers[0];
        await ctx.db.patch("flt_fleets", winner.fleet._id, { status: "idle" });
        await finishBattle(ctx, {
          battle,
          system,
          eventTurn: params.turnNumber,
          winnerEmpireId: winner.empireId,
          winnerFleetId: winner.fleet._id,
          eventType: "system_conquered",
          summary: `${system.name} was conquered after round ${round.roundNumber}`,
          payload: {
            winnerEmpireId: winner.empireId,
            ...(winner.fleet.gameActorId !== undefined
              ? { winnerGameActorId: winner.fleet.gameActorId }
              : {}),
            previousOwnerEmpireId: battle.originalOwnerEmpireId,
            survivingShips: winner.ships,
          },
        });
      } else {
        const newDefender = primaryAttacker(survivingAttackers);
        if (newDefender === undefined) continue;
        const remainingAttackers = survivingAttackers.filter(
          (attacker) => attacker.fleet._id !== newDefender.fleet._id,
        );
        await continueBattleWithNewDefender(ctx, {
          battle,
          system,
          eventTurn: params.turnNumber,
          attackers: remainingAttackers,
          newDefender,
          roundNumber: round.roundNumber,
        });
      }
    } else if (survivingDefender !== null && survivingAttackers.length === 0) {
      await ctx.db.patch("flt_fleets", survivingDefender.fleet._id, { status: "idle" });
      await finishBattle(ctx, {
        battle,
        system,
        eventTurn: params.turnNumber,
        winnerEmpireId: survivingDefender.empireId,
        winnerFleetId: survivingDefender.fleet._id,
        eventType: "system_held",
        summary: `${system.name} held after attackers were destroyed`,
        payload: {
          winnerEmpireId: survivingDefender.empireId,
          attackerEmpireIds: attackers.map((attacker) => attacker.empireId),
          ...(survivingDefender.fleet.gameActorId !== undefined
            ? { winnerGameActorId: survivingDefender.fleet.gameActorId }
            : {}),
          ...(uniqueGameActorIdsForParticipants(attackers).length > 0
            ? { attackerGameActorIds: uniqueGameActorIdsForParticipants(attackers) }
            : {}),
          survivingShips: survivingDefender.ships,
        },
      });
    } else if (survivingDefender === null && survivingAttackers.length === 0) {
      await finishBattle(ctx, {
        battle,
        system,
        eventTurn: params.turnNumber,
        winnerEmpireId: null,
        winnerFleetId: null,
        eventType: "system_held",
        summary: `${system.name}: both battle fleets were destroyed`,
        payload: {
          attackerEmpireIds: attackers.map((attacker) => attacker.empireId),
          defenderEmpireId: defender.empireId,
          ...(defender.fleet.gameActorId !== undefined
            ? { defenderGameActorId: defender.fleet.gameActorId }
            : {}),
          ...(uniqueGameActorIdsForParticipants(attackers).length > 0
            ? { attackerGameActorIds: uniqueGameActorIdsForParticipants(attackers) }
            : {}),
        },
      });
    } else if (survivingDefender !== null) {
      await patchBattleParticipants(ctx, battle, {
        attackers: survivingAttackers,
        defender: survivingDefender,
        phase: "awaitingAttackerDecision",
        roundNumber: round.roundNumber,
        updatedTurn: params.turnNumber,
      });
      await ctx.db.patch("gal_systems", system._id, {
        underAttack: true,
        lastContestedTurn: params.turnNumber,
      });
    } else {
      throw new Error("Unhandled battle outcome.");
    }
  }

}

async function startNewBattlesAndClaimUnopposedSystems(
  ctx: MutationCtx,
  params: {
    gameId: Id<"sim_games">;
    turnNumber: number;
    combatMultipliers: CombatMultipliers;
  },
): Promise<void> {
  const fleets = await loadIdleFleetsForGame(ctx, params.gameId);
  const activeBattleSystemIds = await loadActiveBattleSystemIds(ctx, params.gameId);

  const bySystem = new Map<string, Doc<"flt_fleets">[]>();
  for (const fleet of fleets) {
    if (fleet.strength <= 0) continue;
    const list = bySystem.get(fleet.originSystemId) ?? [];
    list.push(fleet);
    bySystem.set(fleet.originSystemId, list);
  }

  for (const [systemId, systemFleets] of bySystem) {
    if (activeBattleSystemIds.has(systemId)) continue;
    const groups = groupIdleFleetsByEmpire(systemFleets);
    const system = await ctx.db.get("gal_systems", systemId as Id<"gal_systems">);
    if (system === null) continue;

    if (groups.length < 2) {
      // Only transfer ownership when the world is inhabited. Visiting an empty or
      // sub-minimum-population neutral system leaves it unowned so idle fleets are
      // not wiped by abandonUnderpopulatedColony on the next economy pass.
      const pop = system.population ?? 0;
      const inhabited = pop >= POPULATION_MIN_INHABITED_PEOPLE;
      if (
        inhabited &&
        groups.length === 1 &&
        system.ownerEmpireId !== groups[0].empireId
      ) {
        const claimant = groups[0];
        const previousOwnerEmpireId = system.ownerEmpireId;
        const claimantGameActorId =
          primaryFleetForGroup(claimant)?.gameActorId ??
          (await resolveGameActorIdForEmpire(ctx, {
            gameId: params.gameId,
            empireId: claimant.empireId,
          }));
        await ctx.db.patch("gal_systems", system._id, {
          ownerEmpireId: claimant.empireId,
          ownerGameActorId: claimantGameActorId ?? undefined,
          underAttack: false,
          taxBlockedUntilTurn: params.turnNumber + 1,
        });
        await reconcileSystemHolding(ctx, {
          gameId: params.gameId,
          systemId: system._id,
          winnerEmpireId: claimant.empireId,
          ...(claimantGameActorId !== null ? { winnerGameActorId: claimantGameActorId } : {}),
        });
        await insertSimEvent(ctx, {
          gameId: params.gameId,
          turnNumber: params.turnNumber,
          eventType: "system_claimed",
          actorType: claimantGameActorId !== null ? "game_actor" : "empire",
          actorId: claimantGameActorId ?? claimant.empireId,
          targetType: "system",
          targetId: system._id,
          summary: `${system.name} was claimed by an unopposed fleet`,
          payload: {
            systemId: system._id,
            claimantEmpireId: claimant.empireId,
            previousOwnerEmpireId,
            survivingShips: claimant.ships,
          },
        });
      }
      await ctx.db.patch("gal_systems", system._id, { underAttack: false });
      continue;
    }

    const defenderGroup = chooseDefender(groups, system.ownerEmpireId);
    const attackerGroups = groups
      .filter((group) => group.empireId !== defenderGroup.empireId)
      .sort((a, b) => b.ships - a.ships);
    if (attackerGroups.length === 0) continue;

    const defenderFleet = await mergeFleetGroupForBattle(ctx, defenderGroup);
    const defender = participantFromFleet(defenderFleet);
    const attackers: BattleParticipant[] = [];
    for (const attackerGroup of attackerGroups) {
      const fleet = await mergeFleetGroupForBattle(ctx, attackerGroup);
      attackers.push(participantFromFleet(fleet));
    }
    const attacker = primaryAttacker(attackers);
    if (attacker === undefined) continue;
    const attackerShips = attackers.reduce((sum, participant) => sum + participant.ships, 0);

    const battleId = await ctx.db.insert("cmb_battles", {
      gameId: params.gameId,
      systemId: system._id,
      attackerEmpireId: attacker.empireId,
      defenderEmpireId: defenderGroup.empireId,
      attackerFleetId: attacker.fleet._id,
      defenderFleetId: defenderFleet._id,
      attackerFleetIds: attackers.map((participant) => participant.fleet._id),
      defenderFleetIds: [defenderFleet._id],
      originalOwnerEmpireId: system.ownerEmpireId,
      status: "active",
      phase: "opening",
      roundNumber: 0,
      startedTurn: params.turnNumber,
      updatedTurn: params.turnNumber,
    });
    for (const participant of attackers) {
      await ctx.db.patch("flt_fleets", participant.fleet._id, {
        status: "engaged",
        activeBattleId: battleId,
      });
    }
    await ctx.db.patch("flt_fleets", defenderFleet._id, {
      status: "engaged",
      activeBattleId: battleId,
    });
    await ctx.db.patch("gal_systems", system._id, {
      underAttack: true,
      lastContestedTurn: params.turnNumber,
    });

    let attackerMotherships = 0;
    for (const participant of attackers) {
      attackerMotherships += (
        await loadIdleMothershipTargets(ctx, {
          gameId: params.gameId,
          systemId: system._id,
          empireId: participant.empireId,
          gameActorId: participant.fleet.gameActorId,
        })
      ).length;
    }
    const defenderMotherships = await loadIdleMothershipTargets(ctx, {
      gameId: params.gameId,
      systemId: system._id,
      empireId: defenderGroup.empireId,
      gameActorId: defenderFleet.gameActorId,
    });

    await insertSimEvent(ctx, {
      gameId: params.gameId,
      turnNumber: params.turnNumber,
      eventType: "battle_started",
      actorType: attacker.fleet.gameActorId !== undefined ? "game_actor" : "empire",
      actorId: attacker.fleet.gameActorId ?? attacker.empireId,
      targetType: "system",
      targetId: system._id,
      summary: `${system.name}: ${attackerShips} attacking ships engaged ${defender.ships} defenders`,
      payload: {
        battleId,
        systemId: system._id,
        attackerEmpireId: attacker.empireId,
        attackerEmpireIds: attackers.map((participant) => participant.empireId),
        ...(attacker.fleet.gameActorId !== undefined
          ? { attackerGameActorId: attacker.fleet.gameActorId }
          : {}),
        ...(uniqueGameActorIdsForParticipants(attackers).length > 0
          ? { attackerGameActorIds: uniqueGameActorIdsForParticipants(attackers) }
          : {}),
        defenderEmpireId: defenderGroup.empireId,
        ...(defenderFleet.gameActorId !== undefined
          ? { defenderGameActorId: defenderFleet.gameActorId }
          : {}),
        attackerShips,
        defenderShips: defender.ships,
        attackerMotherships,
        defenderMotherships: defenderMotherships.length,
      },
    });

    const rawOpening = resolveOpeningStrike({
      attackerShips,
      defenderShips: defender.ships,
      isDefenderHomeworld:
        system.isHomeworld && system.ownerEmpireId === defenderGroup.empireId,
      multipliers: params.combatMultipliers,
    });
    const adjusted = await applyMultiAttackerMothershipPriorityToRound(ctx, {
      gameId: params.gameId,
      systemId: system._id,
      attackers,
      defender,
      round: rawOpening,
    });
    const opening = adjusted.round;
    await writeBattleRoundEvents(ctx, {
      gameId: params.gameId,
      turnNumber: params.turnNumber,
      battleId,
      system,
      attacker: aggregateAttackerFleetGroup(attackers),
      defender: participantFleetGroup(defender),
      rounds: [opening],
      mothershipEvents: adjusted.events,
    });

    const survivingAttackers = await applyParticipantLosses(
      ctx,
      attackers,
      adjusted.attackerLossesByFleetId,
    );
    if (survivingAttackers.length === 0) {
      await ctx.db.patch("flt_fleets", defenderFleet._id, { status: "idle" });
      const battle = await ctx.db.get("cmb_battles", battleId);
      if (battle !== null) {
        await finishBattle(ctx, {
          battle,
          system,
          eventTurn: params.turnNumber,
          winnerEmpireId: defenderGroup.empireId,
          winnerFleetId: defenderFleet._id,
          eventType: "system_held",
          summary: `${system.name} held after the opening defensive strike`,
          payload: {
            winnerEmpireId: defenderGroup.empireId,
            attackerEmpireIds: attackers.map((participant) => participant.empireId),
            ...(defenderFleet.gameActorId !== undefined
              ? { winnerGameActorId: defenderFleet.gameActorId }
              : {}),
            ...(uniqueGameActorIdsForParticipants(attackers).length > 0
              ? { attackerGameActorIds: uniqueGameActorIdsForParticipants(attackers) }
              : {}),
            survivingShips: defender.ships,
          },
        });
      }
    } else {
      const battle = await ctx.db.get("cmb_battles", battleId);
      if (battle !== null) {
        await patchBattleParticipants(ctx, battle, {
          attackers: survivingAttackers,
          defender,
          phase: "awaitingAttackerDecision",
          roundNumber: 0,
          updatedTurn: params.turnNumber,
        });
      }
      const nextPrimary = primaryAttacker(survivingAttackers);
      if (nextPrimary === undefined) continue;
      await insertSimEvent(ctx, {
        gameId: params.gameId,
        turnNumber: params.turnNumber,
        eventType: "battle_continues",
        actorType: nextPrimary.fleet.gameActorId !== undefined ? "game_actor" : "empire",
        actorId: nextPrimary.fleet.gameActorId ?? nextPrimary.empireId,
        targetType: "system",
        targetId: system._id,
        summary: `${system.name}: attackers survived opening fire; battle continues next turn`,
        payload: {
          battleId,
          systemId: system._id,
          attackerFleetId: nextPrimary.fleet._id,
          attackerFleetIds: survivingAttackers.map((participant) => participant.fleet._id),
          attackerEmpireId: nextPrimary.empireId,
          attackerEmpireIds: survivingAttackers.map((participant) => participant.empireId),
          ...(nextPrimary.fleet.gameActorId !== undefined
            ? { attackerGameActorId: nextPrimary.fleet.gameActorId }
            : {}),
          ...(uniqueGameActorIdsForParticipants(survivingAttackers).length > 0
            ? { attackerGameActorIds: uniqueGameActorIdsForParticipants(survivingAttackers) }
            : {}),
          attackerShips: opening.attackerShipsAfter,
        },
      });
    }
  }
}

export const appendEvent = internalMutation({
  args: {
    gameId: v.id("sim_games"),
    turnNumber: v.number(),
    eventType: v.string(),
    actorType: v.string(),
    actorId: v.string(),
    targetType: v.union(v.string(), v.null()),
    targetId: v.union(v.string(), v.null()),
    summary: v.string(),
    payload: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("sim_events", args);
  },
});

/** If a turn stays `preparing` longer than this, cron may schedule another `resolveTurnJob`. */
const TURN_RESOLUTION_STALE_MS = 3 * 60_000;

function isTurnPreparingState(state: Doc<"sim_turns">["state"]): boolean {
  return state === "preparing" || state === "resolving";
}

async function loadTurnRow(
  ctx: MutationCtx,
  gameId: Id<"sim_games">,
  turnNumber: number,
): Promise<Doc<"sim_turns"> | null> {
  return await ctx.db
    .query("sim_turns")
    .withIndex("by_gameId_and_turnNumber", (q) =>
      q.eq("gameId", gameId).eq("turnNumber", turnNumber),
    )
    .unique();
}

async function loadTurnPreparationRow(
  ctx: MutationCtx,
  gameId: Id<"sim_games">,
  turnNumber: number,
): Promise<Doc<"sim_turn_preparations"> | null> {
  return await ctx.db
    .query("sim_turn_preparations")
    .withIndex("by_gameId_and_turnNumber", (q) =>
      q.eq("gameId", gameId).eq("turnNumber", turnNumber),
    )
    .unique();
}

async function pruneHistoricalTurnPreparationData(
  ctx: MutationCtx,
  gameId: Id<"sim_games">,
  firstRetainedTurn: number,
): Promise<boolean> {
  const staleOps = await ctx.db
    .query("sim_turn_preparation_ops")
    .withIndex("by_gameId_and_turnNumber", (q) =>
      q.eq("gameId", gameId).lt("turnNumber", firstRetainedTurn),
    )
    .take(PREPARATION_OP_PRUNE_BATCH_SIZE);
  for (const row of staleOps) {
    await ctx.db.delete("sim_turn_preparation_ops", row._id);
  }
  if (staleOps.length === PREPARATION_OP_PRUNE_BATCH_SIZE) {
    return true;
  }

  const stalePreparations = await ctx.db
    .query("sim_turn_preparations")
    .withIndex("by_gameId_and_turnNumber", (q) =>
      q.eq("gameId", gameId).lt("turnNumber", firstRetainedTurn),
    )
    .take(PREPARATION_ROW_PRUNE_BATCH_SIZE);
  for (const preparation of stalePreparations) {
    await ctx.db.delete("sim_turn_preparations", preparation._id);
  }
  return stalePreparations.length === PREPARATION_ROW_PRUNE_BATCH_SIZE;
}

async function pruneHistoricalSimEvents(
  ctx: MutationCtx,
  gameId: Id<"sim_games">,
  firstRetainedTurn: number,
): Promise<boolean> {
  const staleEvents = await ctx.db
    .query("sim_events")
    .withIndex("by_gameId_and_turnNumber", (q) =>
      q.eq("gameId", gameId).lt("turnNumber", firstRetainedTurn),
    )
    .take(EVENT_PRUNE_BATCH_SIZE);
  for (const row of staleEvents) {
    await ctx.db.delete("sim_events", row._id);
  }
  return staleEvents.length === EVENT_PRUNE_BATCH_SIZE;
}

async function pruneHistoricalCompletedTraderVoyages(
  ctx: MutationCtx,
  gameId: Id<"sim_games">,
  firstRetainedTurn: number,
): Promise<boolean> {
  const staleDelivered = await ctx.db
    .query("eco_bg_traders")
    .withIndex("by_gameId_and_deliveredTurn", (q) =>
      q.eq("gameId", gameId).lt("deliveredTurn", firstRetainedTurn),
    )
    .take(TRADER_VOYAGE_PRUNE_BATCH_SIZE);
  for (const row of staleDelivered) {
    await ctx.db.delete("eco_bg_traders", row._id);
  }
  if (staleDelivered.length === TRADER_VOYAGE_PRUNE_BATCH_SIZE) {
    return true;
  }

  const cancelledBatch = await ctx.db
    .query("eco_bg_traders")
    .withIndex("by_gameId_and_status", (q) => q.eq("gameId", gameId).eq("status", "cancelled"))
    .take(TRADER_VOYAGE_PRUNE_BATCH_SIZE);
  for (const row of cancelledBatch) {
    await ctx.db.delete("eco_bg_traders", row._id);
  }
  return cancelledBatch.length === TRADER_VOYAGE_PRUNE_BATCH_SIZE;
}

async function pruneHistoricalEconomyMarketSnapshots(
  ctx: MutationCtx,
  gameId: Id<"sim_games">,
  firstRetainedTurn: number,
): Promise<boolean> {
  const staleRows = await ctx.db
    .query("eco_market_snapshots")
    .withIndex("by_gameId_and_turnNumber", (q) =>
      q.eq("gameId", gameId).lt("turnNumber", firstRetainedTurn),
    )
    .take(ECONOMY_TRANSCRIPT_PRUNE_BATCH_SIZE);
  for (const row of staleRows) {
    await ctx.db.delete("eco_market_snapshots", row._id);
  }
  return staleRows.length === ECONOMY_TRANSCRIPT_PRUNE_BATCH_SIZE;
}

async function pruneLegacyEconomyMarketSnapshotsForNonTraderGame(
  ctx: MutationCtx,
  gameId: Id<"sim_games">,
): Promise<boolean> {
  const staleRows = await ctx.db
    .query("eco_market_snapshots")
    .withIndex("by_gameId_and_turnNumber", (q) => q.eq("gameId", gameId))
    .take(ECONOMY_TRANSCRIPT_PRUNE_BATCH_SIZE);
  for (const row of staleRows) {
    await ctx.db.delete("eco_market_snapshots", row._id);
  }
  return staleRows.length === ECONOMY_TRANSCRIPT_PRUNE_BATCH_SIZE;
}

async function pruneHistoricalEconomySystemOutputs(
  ctx: MutationCtx,
  gameId: Id<"sim_games">,
): Promise<boolean> {
  const staleRows = await ctx.db
    .query("eco_system_outputs")
    .withIndex("by_gameId_and_turnNumber", (q) => q.eq("gameId", gameId))
    .take(ECONOMY_TRANSCRIPT_PRUNE_BATCH_SIZE);
  for (const row of staleRows) {
    await ctx.db.delete("eco_system_outputs", row._id);
  }
  return staleRows.length === ECONOMY_TRANSCRIPT_PRUNE_BATCH_SIZE;
}

async function pruneLegacyTraderRuns(
  ctx: MutationCtx,
  gameId: Id<"sim_games">,
): Promise<boolean> {
  const staleRows = await ctx.db
    .query("trd_runs")
    .withIndex("by_gameId_and_turnNumber", (q) => q.eq("gameId", gameId))
    .take(LEGACY_TRADER_ROW_PRUNE_BATCH_SIZE);
  for (const row of staleRows) {
    await ctx.db.delete("trd_runs", row._id);
  }
  return staleRows.length === LEGACY_TRADER_ROW_PRUNE_BATCH_SIZE;
}

async function pruneLegacyTraderCharters(
  ctx: MutationCtx,
  gameId: Id<"sim_games">,
): Promise<boolean> {
  const staleRows = await ctx.db
    .query("trd_charters")
    .withIndex("by_gameId_and_status", (q) => q.eq("gameId", gameId))
    .take(LEGACY_TRADER_ROW_PRUNE_BATCH_SIZE);
  for (const row of staleRows) {
    await ctx.db.delete("trd_charters", row._id);
  }
  return staleRows.length === LEGACY_TRADER_ROW_PRUNE_BATCH_SIZE;
}

async function pruneLegacyTraderIdentities(
  ctx: MutationCtx,
  gameId: Id<"sim_games">,
): Promise<boolean> {
  const staleRows = await ctx.db
    .query("sim_trader_identities")
    .withIndex("by_gameId", (q) => q.eq("gameId", gameId))
    .take(LEGACY_TRADER_ROW_PRUNE_BATCH_SIZE);
  for (const row of staleRows) {
    await ctx.db.delete("sim_trader_identities", row._id);
  }
  return staleRows.length === LEGACY_TRADER_ROW_PRUNE_BATCH_SIZE;
}

async function pruneLegacyTraderVoyagesForNonTraderGame(
  ctx: MutationCtx,
  gameId: Id<"sim_games">,
): Promise<boolean> {
  let hitBatchLimit = false;
  for (const status of ["enRoute", "delivered", "cancelled"] as const) {
    const staleRows = await ctx.db
      .query("eco_bg_traders")
      .withIndex("by_gameId_and_status", (q) => q.eq("gameId", gameId).eq("status", status))
      .take(LEGACY_TRADER_ROW_PRUNE_BATCH_SIZE);
    for (const row of staleRows) {
      await ctx.db.delete("eco_bg_traders", row._id);
    }
    if (staleRows.length === LEGACY_TRADER_ROW_PRUNE_BATCH_SIZE) {
      hitBatchLimit = true;
    }
  }
  return hitBatchLimit;
}

async function pruneLegacyTraderEventsForNonTraderGame(
  ctx: MutationCtx,
  gameId: Id<"sim_games">,
): Promise<boolean> {
  let hitBatchLimit = false;
  for (const eventType of TRADER_EVENT_TYPES) {
    const staleRows = await ctx.db
      .query("sim_events")
      .withIndex("by_gameId_and_eventType", (q) =>
        q.eq("gameId", gameId).eq("eventType", eventType),
      )
      .take(LEGACY_TRADER_EVENT_PRUNE_BATCH_SIZE);
    for (const row of staleRows) {
      await ctx.db.delete("sim_events", row._id);
    }
    if (staleRows.length === LEGACY_TRADER_EVENT_PRUNE_BATCH_SIZE) {
      hitBatchLimit = true;
    }
  }
  return hitBatchLimit;
}

async function upsertTurnPreparationRow(
  ctx: MutationCtx,
  params: {
    gameId: Id<"sim_games">;
    turnNumber: number;
    targetBoundaryAt: number;
    state: Doc<"sim_turn_preparations">["state"];
    requestedAt?: number;
    startedAt?: number;
    preparedAt?: number;
    committedAt?: number;
    resolutionPhase?: TurnResolutionPhase;
    summaryJson?: string;
  },
): Promise<Doc<"sim_turn_preparations">["_id"]> {
  const existing = await loadTurnPreparationRow(ctx, params.gameId, params.turnNumber);
  if (existing !== null) {
    await ctx.db.patch("sim_turn_preparations", existing._id, {
      targetBoundaryAt: params.targetBoundaryAt,
      state: params.state,
      requestedAt: params.requestedAt ?? existing.requestedAt,
      startedAt: params.startedAt,
      preparedAt: params.preparedAt,
      committedAt: params.committedAt,
      resolutionPhase: params.resolutionPhase,
      summaryJson: params.summaryJson,
    });
    return existing._id;
  }

  return await ctx.db.insert("sim_turn_preparations", {
    gameId: params.gameId,
    turnNumber: params.turnNumber,
    targetBoundaryAt: params.targetBoundaryAt,
    state: params.state,
    requestedAt: params.requestedAt ?? Date.now(),
    startedAt: params.startedAt,
    preparedAt: params.preparedAt,
    committedAt: params.committedAt,
    resolutionPhase: params.resolutionPhase,
    summaryJson: params.summaryJson,
  });
}

async function loadStagedPreparationPhase(
  ctx: MutationCtx,
  params: {
    gameId: Id<"sim_games">;
    turnNumber: number;
    phase: TurnResolutionPhase;
  },
): Promise<{
  game: Doc<"sim_games">;
  turn: Doc<"sim_turns">;
  preparation: Doc<"sim_turn_preparations">;
} | null> {
  const game = await loadGameWithMissionModeHydrated(ctx, params.gameId);
  if (game === null) {
    return null;
  }
  if (game.status !== "running") {
    return null;
  }
  if (game.currentTurn > params.turnNumber) {
    return null;
  }
  if (game.currentTurn !== params.turnNumber) {
    throw new Error(
      `Turn resolution expected turn ${params.turnNumber}, but game is on turn ${game.currentTurn}.`,
    );
  }

  const turn = await loadTurnRow(ctx, params.gameId, params.turnNumber);
  if (turn === null) {
    throw new Error("Current turn row not found.");
  }
  if (turn.state === "resolved") {
    return null;
  }

  const preparation = await loadTurnPreparationRow(ctx, params.gameId, params.turnNumber);
  if (preparation === null || preparation.state !== "preparing") {
    return null;
  }

  const currentPhase = parseTurnResolutionPhase(
    preparation.resolutionPhase ?? turn.resolutionPhase,
  );
  const phaseOrder = compareTurnResolutionPhases(currentPhase, params.phase);
  if (phaseOrder > 0) {
    return null;
  }
  if (phaseOrder < 0) {
    throw new Error(`Turn resolution is waiting for ${currentPhase}.`);
  }

  return { game, turn, preparation };
}

async function loadResolutionPhase(
  ctx: MutationCtx,
  params: {
    gameId: Id<"sim_games">;
    turnNumber: number;
    phase: TurnResolutionPhase;
  },
): Promise<{ game: Doc<"sim_games">; turn: Doc<"sim_turns"> } | null> {
  const game = await loadGameWithMissionModeHydrated(ctx, params.gameId);
  if (game === null) {
    return null;
  }
  if (game.status !== "running") {
    return null;
  }
  if (game.currentTurn > params.turnNumber) {
    return null;
  }
  if (game.currentTurn !== params.turnNumber) {
    return null;
  }

  const turn = await loadTurnRow(ctx, params.gameId, params.turnNumber);
  if (turn === null) {
    throw new Error("Current turn row not found.");
  }
  if (turn.state === "resolved") {
    return null;
  }
  if (!isTurnPreparingState(turn.state)) {
    return null;
  }

  const currentPhase = parseTurnResolutionPhase(turn.resolutionPhase);
  const phaseOrder = compareTurnResolutionPhases(currentPhase, params.phase);
  if (phaseOrder > 0) {
    return null;
  }
  if (phaseOrder < 0) {
    throw new Error(`Turn resolution is waiting for ${currentPhase}.`);
  }

  return { game, turn };
}

async function advanceResolutionPhase(
  ctx: MutationCtx,
  turn: Doc<"sim_turns">,
  nextPhase: TurnResolutionPhase,
): Promise<void> {
  if (isTurnPreparingState(turn.state)) {
    await ctx.db.patch("sim_turns", turn._id, {
      resolutionPhase: nextPhase,
    });
  }
  const preparation = await loadTurnPreparationRow(ctx, turn.gameId, turn.turnNumber);
  if (preparation !== null) {
    await ctx.db.patch("sim_turn_preparations", preparation._id, {
      state: "preparing",
      resolutionPhase: nextPhase,
    });
  }
}

async function advanceToNextResolutionPhase(
  ctx: MutationCtx,
  game: Doc<"sim_games">,
  turn: Doc<"sim_turns">,
  currentPhase: TurnResolutionPhase,
): Promise<void> {
  await advanceResolutionPhase(ctx, turn, nextTurnResolutionPhase(game, currentPhase));
}

/**
 * Makes `beginTurnResolution` treat the current turn as stale so a new `resolveTurnJob`
 * can be scheduled (used when an action died mid-pipeline or jobs overlapped).
 */
export const prepareTurnResolutionRetry = internalMutation({
  args: { gameId: v.id("sim_games") },
  handler: async (ctx, args): Promise<void> => {
    const game = await ctx.db.get("sim_games", args.gameId);
    if (game === null || game.status !== "running") {
      return;
    }
    const turn = await loadTurnRow(ctx, args.gameId, game.currentTurn);
    if (turn === null) {
      return;
    }
    const preparation = await loadTurnPreparationRow(ctx, args.gameId, game.currentTurn);
    if (turn.state === "prepared" || preparation?.state === "prepared") {
      await ctx.db.patch("sim_turns", turn._id, {
        state: "open",
        preparedAt: undefined,
        resolvingStartedAt: undefined,
        resolutionPhase: undefined,
      });
      if (preparation !== null) {
        await deletePreparationOperations(ctx, preparation._id);
        await ctx.db.patch("sim_turn_preparations", preparation._id, {
          state: "queued",
          requestedAt: Date.now(),
          startedAt: undefined,
          preparedAt: undefined,
          committedAt: undefined,
          resolutionPhase: undefined,
          summaryJson: undefined,
        });
      }
      return;
    }
    if (!isTurnPreparingState(turn.state) && preparation?.state !== "preparing") {
      return;
    }
    const aged = Date.now() - TURN_RESOLUTION_STALE_MS - 1;
    await ctx.db.patch("sim_turns", turn._id, { resolvingStartedAt: aged });
    // Also mark the preparation envelope as stale so the controller can re-queue it.
    if (preparation !== null) {
      await ctx.db.patch("sim_turn_preparations", preparation._id, { state: "stale" });
    }
  },
});

export const resetCurrentTurnPreparationForRecovery = internalMutation({
  args: { gameId: v.id("sim_games") },
  handler: async (ctx, args): Promise<{ reset: boolean; turnNumber: number | null }> => {
    const game = await ctx.db.get("sim_games", args.gameId);
    if (game === null) {
      return { reset: false, turnNumber: null };
    }
    const turn = await loadTurnRow(ctx, args.gameId, game.currentTurn);
    if (turn === null || (turn.state !== "open" && turn.state !== "prepared")) {
      return { reset: false, turnNumber: game.currentTurn };
    }
    await invalidateOpenTurnPreparation(ctx, args.gameId);
    return { reset: true, turnNumber: game.currentTurn };
  },
});

export const postCommitMaintenance = internalMutation({
  args: {
    gameId: v.id("sim_games"),
    nextTurn: v.number(),
  },
  handler: async (ctx, args): Promise<void> => {
    const game = await loadGameWithMissionModeHydrated(ctx, args.gameId);
    const hasMoreHistoricalPreparationData = await pruneHistoricalTurnPreparationData(
      ctx,
      args.gameId,
      Math.max(1, args.nextTurn - PREPARATION_HISTORY_TURNS_TO_KEEP + 1),
    );
    const liveEventTurnsToKeep = game !== null ? liveEventHistoryTurnsToKeep(game) : null;
    const hasMoreHistoricalEvents =
      game !== null && liveEventTurnsToKeep !== null
        ? await pruneHistoricalSimEvents(
            ctx,
            args.gameId,
            Math.max(1, args.nextTurn - liveEventTurnsToKeep + 1),
          )
        : false;
    const traderVoyageTurnsToKeep =
      game !== null ? completedTraderVoyageHistoryTurnsToKeep(game) : null;
    const hasMoreHistoricalTraderVoyages =
      game !== null && traderVoyageTurnsToKeep !== null
        ? await pruneHistoricalCompletedTraderVoyages(
            ctx,
            args.gameId,
            Math.max(1, args.nextTurn - traderVoyageTurnsToKeep + 1),
          )
        : false;
    const economyTranscriptTurnsToKeep =
      game !== null ? economyTranscriptHistoryTurnsToKeep(game) : null;
    const firstRetainedEconomyTurn =
      game !== null && economyTranscriptTurnsToKeep !== null
        ? Math.max(1, args.nextTurn - economyTranscriptTurnsToKeep + 1)
        : null;
    const hasMoreHistoricalMarketSnapshots =
      game !== null && firstRetainedEconomyTurn !== null
        ? await pruneHistoricalEconomyMarketSnapshots(
            ctx,
            args.gameId,
            firstRetainedEconomyTurn,
          )
        : game !== null && !gameUsesTraderEconomy(game)
          ? await pruneLegacyEconomyMarketSnapshotsForNonTraderGame(ctx, args.gameId)
        : false;
    const hasMoreHistoricalSystemOutputs =
      game !== null
        ? await pruneHistoricalEconomySystemOutputs(
            ctx,
            args.gameId,
          )
        : false;
    const hasMoreLegacyTraderRuns =
      game !== null && !gameUsesTraderEconomy(game)
        ? await pruneLegacyTraderRuns(ctx, args.gameId)
        : false;
    const hasMoreLegacyTraderCharters =
      game !== null && !gameUsesTraderEconomy(game)
        ? await pruneLegacyTraderCharters(ctx, args.gameId)
        : false;
    const hasMoreLegacyTraderIdentities =
      game !== null && !gameUsesTraderEconomy(game)
        ? await pruneLegacyTraderIdentities(ctx, args.gameId)
        : false;
    const hasMoreLegacyTraderVoyages =
      game !== null && !gameUsesTraderEconomy(game)
        ? await pruneLegacyTraderVoyagesForNonTraderGame(ctx, args.gameId)
        : false;
    const hasMoreLegacyTraderEvents =
      game !== null && !gameUsesTraderEconomy(game)
        ? await pruneLegacyTraderEventsForNonTraderGame(ctx, args.gameId)
        : false;
    if (
      hasMoreHistoricalPreparationData ||
      hasMoreHistoricalEvents ||
      hasMoreHistoricalTraderVoyages ||
      hasMoreHistoricalMarketSnapshots ||
      hasMoreHistoricalSystemOutputs ||
      hasMoreLegacyTraderRuns ||
      hasMoreLegacyTraderCharters ||
      hasMoreLegacyTraderIdentities ||
      hasMoreLegacyTraderVoyages ||
      hasMoreLegacyTraderEvents
    ) {
      await ctx.scheduler.runAfter(0, internal.sim.internal.postCommitMaintenance, {
        gameId: args.gameId,
        nextTurn: args.nextTurn,
      });
    }
    await ctx.scheduler.runAfter(0, internal.sim.internal.postCommitFinalizationCheck, {
      gameId: args.gameId,
    });
  },
});

export const postCommitFinalizationCheck = internalMutation({
  args: {
    gameId: v.id("sim_games"),
  },
  handler: async (ctx, args): Promise<void> => {
    await evaluateGameFinalization(ctx, { gameId: args.gameId });
  },
});

export const observeScheduledWake = internalMutation({
  args: {
    gameId: v.id("sim_games"),
    generation: v.number(),
    wakeKind: v.union(v.literal("prepare"), v.literal("boundary")),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ accepted: boolean; turnNumber: number }> => {
    const game = await ctx.db.get("sim_games", args.gameId);
    if (game === null) {
      return { accepted: false, turnNumber: 0 };
    }

    if (game.schedulerGeneration !== args.generation) {
      return { accepted: false, turnNumber: game.currentTurn };
    }
    if (game.status !== "running") {
      return { accepted: false, turnNumber: game.currentTurn };
    }
    if (game.simCronTurnsDisabled === true) {
      return { accepted: false, turnNumber: game.currentTurn };
    }

    const now = Date.now();
    if (game.turnPausedUntilMs !== undefined && now < game.turnPausedUntilMs) {
      return { accepted: false, turnNumber: game.currentTurn };
    }

    await ctx.db.patch("sim_games", args.gameId, {
      lastWakeObservedAt: now,
      nextPreparationWakeAt:
        args.wakeKind === "prepare" ? undefined : game.nextPreparationWakeAt,
      nextBoundaryWakeAt:
        args.wakeKind === "boundary" ? undefined : game.nextBoundaryWakeAt,
    });

    return { accepted: true, turnNumber: game.currentTurn };
  },
});

export const beginTurnResolution = internalMutation({
  args: { gameId: v.id("sim_games") },
  handler: async (
    ctx,
    args,
  ): Promise<{ started: boolean; turnNumber: number; alreadyResolving: boolean }> => {
    const game = await loadGameWithMissionModeHydrated(ctx, args.gameId);
    if (game === null) {
      return { started: false, turnNumber: 0, alreadyResolving: false };
    }
    if (game.status !== "running") {
      return {
        started: false,
        turnNumber: game.currentTurn,
        alreadyResolving: false,
      };
    }

    const now = Date.now();
    if (game.turnPausedUntilMs !== undefined && now < game.turnPausedUntilMs) {
      return {
        started: false,
        turnNumber: game.currentTurn,
        alreadyResolving: false,
      };
    }

    const turnNumber = game.currentTurn;
    const turn = await loadTurnRow(ctx, args.gameId, turnNumber);
    if (turn === null) {
      const targetBoundaryAt = scheduledNextTurnStartedAt({
        turnStartedAtMs: now,
        turnDurationMs: game.turnDurationMs,
      });
      await ctx.db.insert("sim_turns", {
        gameId: args.gameId,
        turnNumber,
        startedAt: now,
        preparedAt: undefined,
        resolvedAt: null,
        state: "preparing",
        resolvingStartedAt: now,
        resolutionPhase: FIRST_TURN_RESOLUTION_PHASE,
      });
      await upsertTurnPreparationRow(ctx, {
        gameId: args.gameId,
        turnNumber,
        targetBoundaryAt,
        state: "preparing",
        requestedAt: now,
        startedAt: now,
        preparedAt: undefined,
        committedAt: undefined,
        resolutionPhase: FIRST_TURN_RESOLUTION_PHASE,
        summaryJson: undefined,
      });
      return { started: true, turnNumber, alreadyResolving: false };
    }

    const targetBoundaryAt = scheduledNextTurnStartedAt({
      turnStartedAtMs: turn.startedAt,
      turnDurationMs: game.turnDurationMs,
    });
    const preparationStartAt = scheduledTurnPreparationAt({
      turnStartedAtMs: turn.startedAt,
      turnDurationMs: game.turnDurationMs,
    });
    const preparation = await loadTurnPreparationRow(ctx, args.gameId, turnNumber);
    const activePreparationStartedAt =
      preparation?.state === "preparing"
        ? preparation.startedAt
        : isTurnPreparingState(turn.state)
          ? turn.resolvingStartedAt
          : undefined;

    if (turn.state === "resolved") {
      return { started: false, turnNumber, alreadyResolving: false };
    }

    if (turn.state === "prepared" || preparation?.state === "prepared") {
      return { started: false, turnNumber, alreadyResolving: false };
    }

    if (turn.state === "open" && now < preparationStartAt) {
      return { started: false, turnNumber, alreadyResolving: false };
    }

    if (
      activePreparationStartedAt !== undefined &&
      now - activePreparationStartedAt < TURN_RESOLUTION_STALE_MS
    ) {
      if (turn.state === "open" && now >= targetBoundaryAt) {
        await ctx.db.patch("sim_turns", turn._id, {
          state: "preparing",
          resolvingStartedAt: activePreparationStartedAt,
          resolutionPhase: parseTurnResolutionPhase(preparation?.resolutionPhase),
          preparedAt: undefined,
        });
      }
      return { started: false, turnNumber, alreadyResolving: true };
    }

    if (now >= targetBoundaryAt) {
      await ctx.db.patch("sim_turns", turn._id, {
        state: "preparing",
        resolvingStartedAt: now,
        resolutionPhase: FIRST_TURN_RESOLUTION_PHASE,
        preparedAt: undefined,
      });
    } else {
      await ctx.db.patch("sim_turns", turn._id, {
        resolvingStartedAt: now,
        preparedAt: undefined,
      });
    }
    await upsertTurnPreparationRow(ctx, {
      gameId: args.gameId,
      turnNumber,
      targetBoundaryAt,
      state: "preparing",
      requestedAt: now,
      startedAt: now,
      preparedAt: undefined,
      committedAt: undefined,
      resolutionPhase: FIRST_TURN_RESOLUTION_PHASE,
      summaryJson: undefined,
    });
    return { started: true, turnNumber, alreadyResolving: false };
  },
});

export const prepareTurnWithStaging = internalMutation({
  args: { gameId: v.id("sim_games"), turnNumber: v.number() },
  handler: async (
    ctx,
    args,
  ): Promise<{ skipped: boolean; preparedTurn: number; opCount: number }> => {
    const phase = await loadStagedPreparationPhase(ctx, {
      ...args,
      phase: FIRST_TURN_RESOLUTION_PHASE,
    });
    if (phase === null) {
      return {
        skipped: true,
        preparedTurn: args.turnNumber,
        opCount: 0,
      };
    }

    const preparationStartedAt = phase.preparation.startedAt;

    const t = args.turnNumber;
    const stage = await createStagedTurnContext(ctx, {
      gameId: args.gameId,
      turnNumber: t,
    });
    const stagedCtx = stage.ctx;

    const movementOrders = await stagedCtx.db
      .query("flt_orders")
      .withIndex("by_gameId_and_turnNumber", (q) =>
        q.eq("gameId", args.gameId).eq("turnNumber", t),
      )
      .take(64);
    const movementFleetIdsWithOrdersThisTurn = new Set(
      movementOrders.map((order) => order.fleetId as string),
    );
    const settings = await loadGameSettings(stagedCtx, args.gameId);
    const defenderAdvantageScale =
      settings.combatDefenderAdvantage / DEFENDER_BASE_MULTIPLIER;
    const combatMultipliers: CombatMultipliers = {
      attackMult: settings.combatAttackMult,
      defendMult: defenderAdvantageScale * settings.combatDefendMult,
      collateralDamageMult: settings.collateralDamageMult,
      foodDamageMult: settings.combatFoodDamageMult,
    };

    await decayRecentBattleDamage(stagedCtx, args.gameId);
    await refreshEmpirePauseBudgets(stagedCtx, args.gameId);
    await applyFleetMoveOrders(stagedCtx, {
      gameId: args.gameId,
      turnNumber: t,
      orders: movementOrders,
    });
    await resolveFleetArrivals(stagedCtx, args.gameId, t);
    await resolveColonyShipArrivals(stagedCtx, args.gameId, t);
    await resolveActiveBattles(stagedCtx, {
      gameId: args.gameId,
      turnNumber: t,
      seed: phase.game.seed,
      orders: movementOrders,
      combatMultipliers,
    });
    await startNewBattlesAndClaimUnopposedSystems(stagedCtx, {
      gameId: args.gameId,
      turnNumber: t,
      combatMultipliers,
    });
    await mergeIdleFleetsAtSameBody(stagedCtx, args.gameId, movementFleetIdsWithOrdersThisTurn);

    await advanceToNextResolutionPhase(ctx, phase.game, phase.turn, FIRST_TURN_RESOLUTION_PHASE);

    const economyOrders = await stagedCtx.db
      .query("flt_orders")
      .withIndex("by_gameId_and_turnNumber", (q) =>
        q.eq("gameId", args.gameId).eq("turnNumber", t),
      )
      .take(64);
    const economyFleetIdsWithOrdersThisTurn = new Set(
      economyOrders.map((order) => order.fleetId as string),
    );
    await applyTurnEconomy(stagedCtx, {
      gameId: args.gameId,
      turnNumber: t,
      fleetIdsWithOrdersThisTurn: economyFleetIdsWithOrdersThisTurn,
      settings,
    });

    await advanceToNextResolutionPhase(ctx, phase.game, phase.turn, "economy");
    await applyNpcStrategy(stagedCtx, {
      gameId: args.gameId,
      turnNumber: t,
    });

    const phasesBeforeGarrisons = resolutionPhasesBetween(
      phase.game,
      "npc",
      "garrisons",
    );
    for (const stagedPhase of phasesBeforeGarrisons) {
      await advanceResolutionPhase(ctx, phase.turn, stagedPhase);

      if (stagedPhase === "trade") {
        await deliverBackgroundTrade(stagedCtx, {
          gameId: args.gameId,
          turnNumber: t,
        });
        continue;
      }

      if (stagedPhase === "traderSetup") {
        await setupBackgroundTradeNpcs(stagedCtx, { gameId: args.gameId });
        continue;
      }

      if (stagedPhase === "tradeSpawn") {
        await spawnBackgroundTrade(stagedCtx, {
          gameId: args.gameId,
          turnNumber: t,
          traderShipCostMult: settings.traderShipCostMult,
        });
        await maybeAdjustAutomatedNpcTraderLimits(stagedCtx, {
          gameId: args.gameId,
          completedTurn: t,
        });
      }
    }

    await advanceToNextResolutionPhase(
      ctx,
      phase.game,
      phase.turn,
      phasesBeforeGarrisons[phasesBeforeGarrisons.length - 1] ?? "npc",
    );
    await applyGarrisonRoutes(stagedCtx, {
      gameId: args.gameId,
      turnNumber: t,
    });

    await advanceToNextResolutionPhase(ctx, phase.game, phase.turn, "garrisons");
    await cleanupFleetOrdersForTurn(stagedCtx, {
      gameId: args.gameId,
      turnNumber: t,
    });

    const operations = stage.buildOperations();
    const preparedAt = Date.now();
    const preparation = await loadTurnPreparationRow(ctx, args.gameId, t);
    if (
      preparation === null ||
      preparation.state !== "preparing" ||
      preparation.startedAt !== preparationStartedAt
    ) {
      return { skipped: true, preparedTurn: t, opCount: 0 };
    }
    const targetBoundaryAt =
      preparation.targetBoundaryAt ??
      scheduledNextTurnStartedAt({
        turnStartedAtMs: phase.turn.startedAt,
        turnDurationMs: phase.game.turnDurationMs,
      });
    const shouldLockPreparedTurn =
      phase.turn.state !== "open" ||
      turnDurationHasElapsed({
        nowMs: preparedAt,
        turnStartedAtMs: phase.turn.startedAt,
        turnDurationMs: phase.game.turnDurationMs,
      });

    if (shouldLockPreparedTurn) {
      await ctx.db.patch("sim_turns", phase.turn._id, {
        preparedAt,
        state: "prepared",
        resolvingStartedAt: undefined,
        resolutionPhase: undefined,
      });
    } else {
      await ctx.db.patch("sim_turns", phase.turn._id, {
        preparedAt,
        resolvingStartedAt: undefined,
        resolutionPhase: undefined,
      });
    }

    const preparationId = await upsertTurnPreparationRow(ctx, {
      gameId: args.gameId,
      turnNumber: t,
      targetBoundaryAt,
      state: "prepared",
      requestedAt: preparation.requestedAt ?? preparedAt,
      startedAt: preparation.startedAt,
      preparedAt,
      committedAt: undefined,
      resolutionPhase: undefined,
      summaryJson: JSON.stringify({
        preparedAt,
        targetBoundaryAt,
        opCount: operations.length,
      }),
    });

    await replacePreparationOperations(ctx, {
      preparationId,
      gameId: args.gameId,
      turnNumber: t,
      operations,
    });

    return { skipped: false, preparedTurn: t, opCount: operations.length };
  },
});

export const resolveTurnMovementPhase = internalMutation({
  args: { gameId: v.id("sim_games"), turnNumber: v.number() },
  handler: async (ctx, args): Promise<{ skipped: boolean }> => {
    const phase = await loadResolutionPhase(ctx, {
      ...args,
      phase: FIRST_TURN_RESOLUTION_PHASE,
    });
    if (phase === null) return { skipped: true };

    const { game, turn } = phase;
    const t = args.turnNumber;
    const orders = await ctx.db
      .query("flt_orders")
      .withIndex("by_gameId_and_turnNumber", (q) =>
        q.eq("gameId", args.gameId).eq("turnNumber", t),
      )
      .take(64);

    const fleetIdsWithOrdersThisTurn = new Set(
      orders.map((order) => order.fleetId as string),
    );

    const settings = await loadGameSettings(ctx, args.gameId);
    const defenderAdvantageScale =
      settings.combatDefenderAdvantage / DEFENDER_BASE_MULTIPLIER;
    const combatMultipliers: CombatMultipliers = {
      attackMult: settings.combatAttackMult,
      defendMult: defenderAdvantageScale * settings.combatDefendMult,
      collateralDamageMult: settings.collateralDamageMult,
      foodDamageMult: settings.combatFoodDamageMult,
    };

    await decayRecentBattleDamage(ctx, args.gameId);
    await refreshEmpirePauseBudgets(ctx, args.gameId);
    await applyFleetMoveOrders(ctx, {
      gameId: args.gameId,
      turnNumber: t,
      orders,
    });
    await resolveFleetArrivals(ctx, args.gameId, t);
    await resolveColonyShipArrivals(ctx, args.gameId, t);
    await resolveActiveBattles(ctx, {
      gameId: args.gameId,
      turnNumber: t,
      seed: game.seed,
      orders,
      combatMultipliers,
    });
    await startNewBattlesAndClaimUnopposedSystems(ctx, {
      gameId: args.gameId,
      turnNumber: t,
      combatMultipliers,
    });
    await mergeIdleFleetsAtSameBody(ctx, args.gameId, fleetIdsWithOrdersThisTurn);

    await advanceToNextResolutionPhase(ctx, game, turn, FIRST_TURN_RESOLUTION_PHASE);
    return { skipped: false };
  },
});

export const resolveTurnEconomyPhase = internalMutation({
  args: { gameId: v.id("sim_games"), turnNumber: v.number() },
  handler: async (ctx, args): Promise<{ skipped: boolean }> => {
    const phase = await loadResolutionPhase(ctx, { ...args, phase: "economy" });
    if (phase === null) return { skipped: true };

    const orders = await ctx.db
      .query("flt_orders")
      .withIndex("by_gameId_and_turnNumber", (q) =>
        q.eq("gameId", args.gameId).eq("turnNumber", args.turnNumber),
      )
      .take(64);
    const fleetIdsWithOrdersThisTurn = new Set(
      orders.map((order) => order.fleetId as string),
    );
    const settings = await loadGameSettings(ctx, args.gameId);

    await applyTurnEconomy(ctx, {
      gameId: args.gameId,
      turnNumber: args.turnNumber,
      fleetIdsWithOrdersThisTurn,
      settings,
    });

    await advanceToNextResolutionPhase(ctx, phase.game, phase.turn, "economy");
    return { skipped: false };
  },
});

export const resolveTurnNpcPhase = internalMutation({
  args: { gameId: v.id("sim_games"), turnNumber: v.number() },
  handler: async (ctx, args): Promise<{ skipped: boolean }> => {
    const phase = await loadResolutionPhase(ctx, { ...args, phase: "npc" });
    if (phase === null) return { skipped: true };

    await applyNpcStrategy(ctx, {
      gameId: args.gameId,
      turnNumber: args.turnNumber,
    });

    await advanceToNextResolutionPhase(ctx, phase.game, phase.turn, "npc");
    return { skipped: false };
  },
});

export const resolveTurnTradePhase = internalMutation({
  args: { gameId: v.id("sim_games"), turnNumber: v.number() },
  handler: async (ctx, args): Promise<{ skipped: boolean }> => {
    const phase = await loadResolutionPhase(ctx, { ...args, phase: "trade" });
    if (phase === null) return { skipped: true };

    if (!gameRunsResolutionPhase(phase.game, "trade")) {
      await advanceToNextResolutionPhase(ctx, phase.game, phase.turn, "trade");
      return { skipped: false };
    }

    await deliverBackgroundTrade(ctx, {
      gameId: args.gameId,
      turnNumber: args.turnNumber,
    });

    await advanceToNextResolutionPhase(ctx, phase.game, phase.turn, "trade");
    return { skipped: false };
  },
});

export const resolveTurnTraderSetupPhase = internalMutation({
  args: { gameId: v.id("sim_games"), turnNumber: v.number() },
  handler: async (ctx, args): Promise<{ skipped: boolean }> => {
    const phase = await loadResolutionPhase(ctx, { ...args, phase: "traderSetup" });
    if (phase === null) return { skipped: true };

    if (!gameRunsResolutionPhase(phase.game, "traderSetup")) {
      await advanceToNextResolutionPhase(ctx, phase.game, phase.turn, "traderSetup");
      return { skipped: false };
    }

    await setupBackgroundTradeNpcs(ctx, { gameId: args.gameId });

    await advanceToNextResolutionPhase(ctx, phase.game, phase.turn, "traderSetup");
    return { skipped: false };
  },
});

export const resolveTurnTradeSpawnPhase = internalMutation({
  args: { gameId: v.id("sim_games"), turnNumber: v.number() },
  handler: async (ctx, args): Promise<{ skipped: boolean }> => {
    const phase = await loadResolutionPhase(ctx, { ...args, phase: "tradeSpawn" });
    if (phase === null) return { skipped: true };

    if (!gameRunsResolutionPhase(phase.game, "tradeSpawn")) {
      await advanceToNextResolutionPhase(ctx, phase.game, phase.turn, "tradeSpawn");
      return { skipped: false };
    }

    const settings = await loadGameSettings(ctx, args.gameId);
    await ctx.scheduler.runAfter(
      0,
      internal.sim.economy.applyBackgroundTrade.spawnBackgroundTradeForTurn,
      {
        gameId: args.gameId,
        turnNumber: args.turnNumber,
        traderShipCostMult: settings.traderShipCostMult,
      },
    );
    await maybeAdjustAutomatedNpcTraderLimits(ctx, {
      gameId: args.gameId,
      completedTurn: args.turnNumber,
    });

    await advanceToNextResolutionPhase(ctx, phase.game, phase.turn, "tradeSpawn");
    return { skipped: false };
  },
});

export const resolveTurnGarrisonsPhase = internalMutation({
  args: { gameId: v.id("sim_games"), turnNumber: v.number() },
  handler: async (ctx, args): Promise<{ skipped: boolean }> => {
    const phase = await loadResolutionPhase(ctx, { ...args, phase: "garrisons" });
    if (phase === null) return { skipped: true };

    await applyGarrisonRoutes(ctx, {
      gameId: args.gameId,
      turnNumber: args.turnNumber,
    });

    await advanceToNextResolutionPhase(ctx, phase.game, phase.turn, "garrisons");
    return { skipped: false };
  },
});

export const finalizeTurnPreparation = internalMutation({
  args: { gameId: v.id("sim_games"), turnNumber: v.number() },
  handler: async (
    ctx,
    args,
  ): Promise<{ skipped: boolean; preparedTurn: number }> => {
    const phase = await loadResolutionPhase(ctx, { ...args, phase: "finalize" });
    if (phase === null) {
      return {
        skipped: true,
        preparedTurn: args.turnNumber,
      };
    }

    const t = args.turnNumber;
    await cleanupFleetOrdersForTurn(ctx, {
      gameId: args.gameId,
      turnNumber: t,
    });

    const preparedAt = Date.now();
    const preparation = await loadTurnPreparationRow(ctx, args.gameId, args.turnNumber);
    const targetBoundaryAt =
      preparation?.targetBoundaryAt ??
      scheduledNextTurnStartedAt({
        turnStartedAtMs: phase.turn.startedAt,
        turnDurationMs: phase.game.turnDurationMs,
      });
    await ctx.db.patch("sim_turns", phase.turn._id, {
      preparedAt,
      state: "prepared",
      resolutionPhase: undefined,
    });

    await upsertTurnPreparationRow(ctx, {
      gameId: args.gameId,
      turnNumber: args.turnNumber,
      targetBoundaryAt,
      state: "prepared",
      requestedAt: preparation?.requestedAt ?? preparedAt,
      startedAt: preparation?.startedAt,
      preparedAt,
      committedAt: undefined,
      resolutionPhase: undefined,
      summaryJson: JSON.stringify({ preparedAt, targetBoundaryAt }),
    });

    return { skipped: false, preparedTurn: t };
  },
});

export const commitPreparedTurn = internalMutation({
  args: { gameId: v.id("sim_games"), turnNumber: v.optional(v.number()) },
  handler: async (
    ctx,
    args,
  ): Promise<{ skipped: boolean; committed: boolean; resolvedTurn: number; nextTurn: number }> => {
    const game = await loadGameWithMissionModeHydrated(ctx, args.gameId);
    if (game === null) {
      return {
        skipped: true,
        committed: false,
        resolvedTurn: args.turnNumber ?? 0,
        nextTurn: args.turnNumber ?? 0,
      };
    }
    if (game.status !== "running") {
      return {
        skipped: true,
        committed: false,
        resolvedTurn: args.turnNumber ?? game.currentTurn,
        nextTurn: game.currentTurn,
      };
    }

    const turnNumber = args.turnNumber ?? game.currentTurn;

    const now = Date.now();
    if (game.turnPausedUntilMs !== undefined && now < game.turnPausedUntilMs) {
      return {
        skipped: true,
        committed: false,
        resolvedTurn: turnNumber,
        nextTurn: game.currentTurn,
      };
    }

    if (game.currentTurn > turnNumber) {
      return {
        skipped: true,
        committed: false,
        resolvedTurn: turnNumber,
        nextTurn: game.currentTurn,
      };
    }
    if (game.currentTurn !== turnNumber) {
      throw new Error(
        `Turn commit expected turn ${turnNumber}, but game is on turn ${game.currentTurn}.`,
      );
    }

    const turn = await loadTurnRow(ctx, args.gameId, turnNumber);
    if (turn === null || turn.state === "resolved") {
      return {
        skipped: true,
        committed: false,
        resolvedTurn: turnNumber,
        nextTurn: game.currentTurn,
      };
    }

    const preparation = await loadTurnPreparationRow(ctx, args.gameId, turnNumber);
    if (preparation === null || preparation.state !== "prepared") {
      return {
        skipped: true,
        committed: false,
        resolvedTurn: turnNumber,
        nextTurn: game.currentTurn,
      };
    }

    if (
      !turnDurationHasElapsed({
        nowMs: now,
        turnStartedAtMs: turn.startedAt,
        turnDurationMs: game.turnDurationMs,
      })
    ) {
      return {
        skipped: true,
        committed: false,
        resolvedTurn: turnNumber,
        nextTurn: game.currentTurn,
      };
    }

    const t = turnNumber;
    const nextTurn = t + 1;
    const resolvedAt = now;
    const targetBoundaryAt =
      preparation?.targetBoundaryAt ??
      scheduledNextTurnStartedAt({
        turnStartedAtMs: turn.startedAt,
        turnDurationMs: game.turnDurationMs,
      });
    const effectivePreparedAt = preparation?.preparedAt ?? turn.preparedAt ?? null;
    const nextTurnStartedAt = committedNextTurnStartedAt({
      turnStartedAtMs: turn.startedAt,
      turnDurationMs: game.turnDurationMs,
      preparedAtMs: effectivePreparedAt ?? undefined,
      committedAtMs: resolvedAt,
    });

    try {
      if (preparation !== null) {
        await applyPreparationOperations(ctx, preparation._id);
      }
    } catch (error) {
      throw new Error(
        `commitPreparedTurn(applyPreparationOperations): ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    let winner: Doc<"emp_states"> | null = null;
    try {
      await ctx.db.patch("sim_turns", turn._id, {
        resolvedAt,
        state: "resolved",
        resolvingStartedAt: undefined,
      });

      await upsertTurnPreparationRow(ctx, {
        gameId: args.gameId,
        turnNumber: t,
        targetBoundaryAt,
        state: "committed",
        requestedAt: preparation?.requestedAt ?? resolvedAt,
        startedAt: preparation?.startedAt,
        preparedAt: effectivePreparedAt ?? undefined,
        committedAt: resolvedAt,
        resolutionPhase: undefined,
        summaryJson: JSON.stringify({
          preparedAt: effectivePreparedAt,
          committedAt: resolvedAt,
          // Negative means prepared ahead of boundary; positive means overrun.
          commitLagMs: (effectivePreparedAt ?? resolvedAt) - targetBoundaryAt,
        }),
      });

      if (preparation !== null) {
        await deletePreparationOperations(ctx, preparation._id);
      }

      await recordGameTurnResolved(ctx, args.gameId, resolvedAt);
      winner = await finishGameIfSingleEmpireRemains(ctx, args.gameId, t);
    } catch (error) {
      throw new Error(
        `commitPreparedTurn(commit bookkeeping): ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    if (winner !== null) {
      try {
        await evaluateGameFinalization(ctx, { gameId: args.gameId });
      } catch (error) {
        throw new Error(
          `commitPreparedTurn(winner finalization): ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      return { skipped: false, committed: true, resolvedTurn: t, nextTurn: t };
    }

    const scheduledRatio = game.nextTurnAutoResolveDelayRatio;
    const gamePatch: {
      currentTurn: number;
      nextTurnAutoResolveDelayRatio?: undefined;
      turnPausedUntilMs?: number;
    } = { currentTurn: nextTurn };
    if (scheduledRatio !== undefined && Number.isFinite(scheduledRatio)) {
      gamePatch.nextTurnAutoResolveDelayRatio = undefined;
      const r = Math.max(0, Math.min(1, scheduledRatio));
      if (r > 0) {
        const delayMs = Math.round(r * Math.max(1, game.turnDurationMs));
        gamePatch.turnPausedUntilMs = nextTurnStartedAt + delayMs;
      } else {
        gamePatch.turnPausedUntilMs = undefined;
      }
    }
    try {
      await ctx.db.patch("sim_games", args.gameId, gamePatch);

      const existingNextTurn = await loadTurnRow(ctx, args.gameId, nextTurn);
      if (existingNextTurn === null) {
        await ctx.db.insert("sim_turns", {
          gameId: args.gameId,
          turnNumber: nextTurn,
          startedAt: nextTurnStartedAt,
          resolvedAt: null,
          state: "open",
        });
      }
      await upsertTurnPreparationRow(ctx, {
        gameId: args.gameId,
        turnNumber: nextTurn,
        targetBoundaryAt: scheduledNextTurnStartedAt({
          turnStartedAtMs: nextTurnStartedAt,
          turnDurationMs: game.turnDurationMs,
        }),
        state: "queued",
        requestedAt: resolvedAt,
        startedAt: undefined,
        preparedAt: undefined,
        committedAt: undefined,
        resolutionPhase: undefined,
        summaryJson: undefined,
      });

      await ctx.db.insert("sim_events", {
        gameId: args.gameId,
        turnNumber: t,
        eventType: "turn_resolved",
        actorType: "sim",
        actorId: args.gameId,
        targetType: null,
        targetId: null,
        summary: `Turn ${t} resolved → turn ${nextTurn}`,
        payload: JSON.stringify({ resolvedTurn: t, nextTurn }),
      });

      await scheduleGameTurnWakeups(ctx, {
        gameId: args.gameId,
        turnStartedAtMs: nextTurnStartedAt,
        turnDurationMs: game.turnDurationMs,
        nowMs: resolvedAt,
      });

      await ctx.scheduler.runAfter(0, internal.sim.internal.postCommitMaintenance, {
        gameId: args.gameId,
        nextTurn,
      });
    } catch (error) {
      throw new Error(
        `commitPreparedTurn(next turn scheduling): ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    return { skipped: false, committed: true, resolvedTurn: t, nextTurn };
  },
});

/** @deprecated Dead code — superseded by the phase-split prepare/commit pipeline. */
export const resolveTurn = internalMutation({
  args: { gameId: v.id("sim_games") },
  handler: async (ctx, args): Promise<{ resolvedTurn: number; nextTurn: number }> => {
    const game = await loadGameWithMissionModeHydrated(ctx, args.gameId);
    if (game === null) {
      throw new Error("Game not found.");
    }
    if (game.status !== "running") {
      throw new Error("Game is not running.");
    }

    const t = game.currentTurn;

    const orders = await ctx.db
      .query("flt_orders")
      .withIndex("by_gameId_and_turnNumber", (q) =>
        q.eq("gameId", args.gameId).eq("turnNumber", t),
      )
      .take(64);

    const fleetIdsWithOrdersThisTurn = new Set(
      orders.map((order) => order.fleetId as string),
    );

    // Load god-mode settings once — shared by economy, combat, and trader engines.
    const settings = await loadGameSettings(ctx, args.gameId);
    // Scale combatDefendMult so that combatDefenderAdvantage replaces the hardcoded base ratio.
    const defenderAdvantageScale =
      settings.combatDefenderAdvantage / DEFENDER_BASE_MULTIPLIER;
    const combatMultipliers: CombatMultipliers = {
      attackMult: settings.combatAttackMult,
      defendMult: defenderAdvantageScale * settings.combatDefendMult,
      collateralDamageMult: settings.collateralDamageMult,
      foodDamageMult: settings.combatFoodDamageMult,
    };

    await decayRecentBattleDamage(ctx, args.gameId);
    await refreshEmpirePauseBudgets(ctx, args.gameId);

    await applyFleetMoveOrders(ctx, {
      gameId: args.gameId,
      turnNumber: t,
      orders,
    });

    await resolveFleetArrivals(ctx, args.gameId, t);
    await resolveColonyShipArrivals(ctx, args.gameId, t);
    await resolveActiveBattles(ctx, {
      gameId: args.gameId,
      turnNumber: t,
      seed: game.seed,
      orders,
      combatMultipliers,
    });
    await startNewBattlesAndClaimUnopposedSystems(ctx, {
      gameId: args.gameId,
      turnNumber: t,
      combatMultipliers,
    });
    await mergeIdleFleetsAtSameBody(ctx, args.gameId, fleetIdsWithOrdersThisTurn);

    await applyTurnEconomy(ctx, {
      gameId: args.gameId,
      turnNumber: t,
      fleetIdsWithOrdersThisTurn,
      settings,
    });

    if (gameUsesTraderEconomy(game)) {
      // Background traders run after economy so per-system foodPrice values are current.
      await applyBackgroundTrade(ctx, {
        gameId: args.gameId,
        turnNumber: t,
        traderShipCostMult: settings.traderShipCostMult,
      });

      await maybeAdjustAutomatedNpcTraderLimits(ctx, {
        gameId: args.gameId,
        completedTurn: t,
      });
    }

    await ctx.scheduler.runAfter(
      0,
      internal.sim.economy.applyNpcStrategy.applyNpcStrategyAndGarrisonRoutes,
      {
        gameId: args.gameId,
        turnNumber: t,
      },
    );

    const activeTurn = await ctx.db
      .query("sim_turns")
      .withIndex("by_gameId_and_turnNumber", (q) =>
        q.eq("gameId", args.gameId).eq("turnNumber", t),
      )
      .unique();

    if (activeTurn !== null) {
      await ctx.db.patch("sim_turns", activeTurn._id, {
        resolvedAt: Date.now(),
        state: "resolved",
      });
    }

    const nextTurn = t + 1;
    const nextTurnStartedAt =
      activeTurn !== null
        ? scheduledNextTurnStartedAt({
            turnStartedAtMs: activeTurn.startedAt,
            turnDurationMs: game.turnDurationMs,
          })
        : Date.now();
    await ctx.db.patch("sim_games", args.gameId, { currentTurn: nextTurn });

    await ctx.db.insert("sim_turns", {
      gameId: args.gameId,
      turnNumber: nextTurn,
      startedAt: nextTurnStartedAt,
      resolvedAt: null,
      state: "open",
    });

    await ctx.db.insert("sim_events", {
      gameId: args.gameId,
      turnNumber: t,
      eventType: "turn_resolved",
      actorType: "sim",
      actorId: args.gameId,
      targetType: null,
      targetId: null,
      summary: `Turn ${t} resolved → turn ${nextTurn}`,
      payload: JSON.stringify({ resolvedTurn: t, nextTurn }),
    });

    return { resolvedTurn: t, nextTurn };
  },
});
