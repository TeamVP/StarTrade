import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { internalMutation } from "../_generated/server";
import { internal } from "../_generated/api";
import { v } from "convex/values";
import { PAUSE_BUDGET_CAP_SECONDS, PAUSE_BUDGET_REFRESH_MS } from "./economy/constants";
import {
  applyBackgroundTrade,
  deliverBackgroundTrade,
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
import { applyFleetMoveOrders, cleanupFleetOrdersForTurn } from "./fleetOrders";
import { applyGarrisonRoutes } from "./garrisonRoutes";
import { reconcileSystemHolding } from "./systemHoldings";
import { POPULATION_MIN_INHABITED_PEOPLE } from "./economy/population";
import { findLinkBetweenSystems } from "../gal/linkUtils";
import { travelTurnsFromLinkCost } from "./fleetDispatch";
import { scheduledNextTurnStartedAt, turnDurationHasElapsed } from "./turnTiming";

/** Max en-route fleet rows scanned for arrivals (indexed `by_gameId_and_status`). */
const MAX_ENROUTE_FLEETS_SCAN = 768;
/** Max idle fleet rows scanned for combat/merge passes (indexed). */
const MAX_IDLE_FLEETS_SCAN = 1024;

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
    .filter((ship) => ship.empireId === params.empireId)
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
  await insertSimEvent(ctx, {
    gameId: params.gameId,
    turnNumber: params.turnNumber,
    eventType: "battle_reinforced",
    actorType: "empire",
    actorId: params.participant.empireId,
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
    await insertSimEvent(ctx, {
      gameId: params.gameId,
      turnNumber: params.turnNumber,
      eventType: "battle_reinforced",
      actorType: "empire",
      actorId: idleGroup.empireId,
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
  for (const round of params.rounds) {
    const mothershipEvents = params.mothershipEvents ?? [];
    const destroyedMotherships = mothershipEvents.filter((event) => event.destroyed);
    await insertSimEvent(ctx, {
      gameId: params.gameId,
      turnNumber: params.turnNumber,
      eventType: "battle_round_resolved",
      actorType: "empire",
      actorId: params.attacker.empireId,
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
        defenderEmpireId: params.defender.empireId,
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
    winnerFleetId: Id<"flt_fleets"> | null;
    eventType: "system_conquered" | "system_held";
    summary: string;
    payload: Record<string, unknown>;
  },
): Promise<void> {
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
      underAttack: false,
      recentBattleTurns: Math.max(params.system.recentBattleTurns ?? 0, 3),
    };
    if (conquered) {
      ownerPatch.taxBlockedUntilTurn = params.eventTurn + 1;
      await reconcileSystemHolding(ctx, {
        gameId: params.battle.gameId,
        systemId: params.system._id,
        winnerEmpireId: params.winnerEmpireId,
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
    actorType: params.winnerEmpireId === null ? "system" : "empire",
    actorId: params.winnerEmpireId ?? params.system._id,
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
  await ctx.db.patch("gal_systems", params.system._id, {
    ownerEmpireId: params.newDefender.empireId,
    underAttack: true,
    lastContestedTurn: params.eventTurn,
    taxBlockedUntilTurn: params.eventTurn + 1,
    recentBattleTurns: Math.max(params.system.recentBattleTurns ?? 0, 3),
  });
  await reconcileSystemHolding(ctx, {
    gameId: params.battle.gameId,
    systemId: params.system._id,
    winnerEmpireId: params.newDefender.empireId,
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
    actorType: "empire",
    actorId: params.newDefender.empireId,
    targetType: "system",
    targetId: params.system._id,
    summary: `${params.system.name}: the strongest surviving attacker became the new defender`,
    payload: {
      battleId: params.battle._id,
      systemId: params.system._id,
      defenderEmpireId: params.newDefender.empireId,
      defenderFleetId: params.newDefender.fleet._id,
      survivingShips: params.newDefender.ships,
      attackerEmpireIds: params.attackers.map((attacker) => attacker.empireId),
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
        await ctx.db.patch("gal_systems", system._id, {
          ownerEmpireId: claimant.empireId,
          underAttack: false,
          taxBlockedUntilTurn: params.turnNumber + 1,
        });
        await reconcileSystemHolding(ctx, {
          gameId: params.gameId,
          systemId: system._id,
          winnerEmpireId: claimant.empireId,
        });
        await insertSimEvent(ctx, {
          gameId: params.gameId,
          turnNumber: params.turnNumber,
          eventType: "system_claimed",
          actorType: "empire",
          actorId: claimant.empireId,
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
        })
      ).length;
    }
    const defenderMotherships = await loadIdleMothershipTargets(ctx, {
      gameId: params.gameId,
      systemId: system._id,
      empireId: defenderGroup.empireId,
    });

    await insertSimEvent(ctx, {
      gameId: params.gameId,
      turnNumber: params.turnNumber,
      eventType: "battle_started",
      actorType: "empire",
      actorId: attacker.empireId,
      targetType: "system",
      targetId: system._id,
      summary: `${system.name}: ${attackerShips} attacking ships engaged ${defender.ships} defenders`,
      payload: {
        battleId,
        systemId: system._id,
        attackerEmpireId: attacker.empireId,
        attackerEmpireIds: attackers.map((participant) => participant.empireId),
        defenderEmpireId: defenderGroup.empireId,
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
        actorType: "empire",
        actorId: nextPrimary.empireId,
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

/** If a turn stays `resolving` longer than this, cron may schedule another `resolveTurnJob`. */
const TURN_RESOLUTION_STALE_MS = 3 * 60_000;
const RESOLUTION_PHASES = [
  "movement",
  "economy",
  "npc",
  "trade",
  "traderSetup",
  "tradeSpawn",
  "garrisons",
  "finalize",
] as const;
type TurnResolutionPhase = (typeof RESOLUTION_PHASES)[number];

function phaseIndex(phase: TurnResolutionPhase): number {
  return RESOLUTION_PHASES.indexOf(phase);
}

function readTurnResolutionPhase(value: string | undefined): TurnResolutionPhase {
  if (
    value === "movement" ||
    value === "economy" ||
    value === "npc" ||
    value === "trade" ||
    value === "traderSetup" ||
    value === "tradeSpawn" ||
    value === "garrisons" ||
    value === "finalize"
  ) {
    return value;
  }
  return "movement";
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

async function loadResolutionPhase(
  ctx: MutationCtx,
  params: {
    gameId: Id<"sim_games">;
    turnNumber: number;
    phase: TurnResolutionPhase;
  },
): Promise<{ game: Doc<"sim_games">; turn: Doc<"sim_turns"> } | null> {
  const game = await ctx.db.get("sim_games", params.gameId);
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
  if (turn.state !== "resolving") {
    throw new Error("Turn is not locked for resolution.");
  }

  const currentPhase = readTurnResolutionPhase(turn.resolutionPhase);
  const currentIdx = phaseIndex(currentPhase);
  const expectedIdx = phaseIndex(params.phase);
  if (currentIdx > expectedIdx) {
    return null;
  }
  if (currentIdx < expectedIdx) {
    throw new Error(`Turn resolution is waiting for ${currentPhase}.`);
  }

  return { game, turn };
}

async function advanceResolutionPhase(
  ctx: MutationCtx,
  turn: Doc<"sim_turns">,
  nextPhase: TurnResolutionPhase,
): Promise<void> {
  await ctx.db.patch("sim_turns", turn._id, {
    resolutionPhase: nextPhase,
  });
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
    if (turn === null || turn.state !== "resolving") {
      return;
    }
    const aged = Date.now() - TURN_RESOLUTION_STALE_MS - 1;
    await ctx.db.patch("sim_turns", turn._id, { resolvingStartedAt: aged });
  },
});

export const beginTurnResolution = internalMutation({
  args: { gameId: v.id("sim_games") },
  handler: async (
    ctx,
    args,
  ): Promise<{ started: boolean; turnNumber: number; alreadyResolving: boolean }> => {
    const game = await ctx.db.get("sim_games", args.gameId);
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
      await ctx.db.insert("sim_turns", {
        gameId: args.gameId,
        turnNumber,
        startedAt: now,
        resolvedAt: null,
        state: "resolving",
        resolvingStartedAt: now,
        resolutionPhase: "movement",
      });
      return { started: true, turnNumber, alreadyResolving: false };
    }

    if (turn.state === "resolved") {
      return { started: false, turnNumber, alreadyResolving: false };
    }

    if (
      turn.state === "open" &&
      !turnDurationHasElapsed({
        nowMs: now,
        turnStartedAtMs: turn.startedAt,
        turnDurationMs: game.turnDurationMs,
      })
    ) {
      return { started: false, turnNumber, alreadyResolving: false };
    }

    if (
      turn.state === "resolving" &&
      turn.resolvingStartedAt !== undefined &&
      now - turn.resolvingStartedAt < TURN_RESOLUTION_STALE_MS
    ) {
      return { started: false, turnNumber, alreadyResolving: true };
    }

    await ctx.db.patch("sim_turns", turn._id, {
      state: "resolving",
      resolvingStartedAt: now,
      resolutionPhase: readTurnResolutionPhase(turn.resolutionPhase),
    });
    return { started: true, turnNumber, alreadyResolving: false };
  },
});

export const resolveTurnMovementPhase = internalMutation({
  args: { gameId: v.id("sim_games"), turnNumber: v.number() },
  handler: async (ctx, args): Promise<{ skipped: boolean }> => {
    const phase = await loadResolutionPhase(ctx, { ...args, phase: "movement" });
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

    await advanceResolutionPhase(ctx, turn, "economy");
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

    await advanceResolutionPhase(ctx, phase.turn, "npc");
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

    await advanceResolutionPhase(ctx, phase.turn, "trade");
    return { skipped: false };
  },
});

export const resolveTurnTradePhase = internalMutation({
  args: { gameId: v.id("sim_games"), turnNumber: v.number() },
  handler: async (ctx, args): Promise<{ skipped: boolean }> => {
    const phase = await loadResolutionPhase(ctx, { ...args, phase: "trade" });
    if (phase === null) return { skipped: true };

    await deliverBackgroundTrade(ctx, {
      gameId: args.gameId,
      turnNumber: args.turnNumber,
    });

    await advanceResolutionPhase(ctx, phase.turn, "traderSetup");
    return { skipped: false };
  },
});

export const resolveTurnTraderSetupPhase = internalMutation({
  args: { gameId: v.id("sim_games"), turnNumber: v.number() },
  handler: async (ctx, args): Promise<{ skipped: boolean }> => {
    const phase = await loadResolutionPhase(ctx, { ...args, phase: "traderSetup" });
    if (phase === null) return { skipped: true };

    await setupBackgroundTradeNpcs(ctx, { gameId: args.gameId });

    await advanceResolutionPhase(ctx, phase.turn, "tradeSpawn");
    return { skipped: false };
  },
});

export const resolveTurnTradeSpawnPhase = internalMutation({
  args: { gameId: v.id("sim_games"), turnNumber: v.number() },
  handler: async (ctx, args): Promise<{ skipped: boolean }> => {
    const phase = await loadResolutionPhase(ctx, { ...args, phase: "tradeSpawn" });
    if (phase === null) return { skipped: true };

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

    await advanceResolutionPhase(ctx, phase.turn, "garrisons");
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

    await advanceResolutionPhase(ctx, phase.turn, "finalize");
    return { skipped: false };
  },
});

export const finalizeTurnResolution = internalMutation({
  args: { gameId: v.id("sim_games"), turnNumber: v.number() },
  handler: async (
    ctx,
    args,
  ): Promise<{ skipped: boolean; resolvedTurn: number; nextTurn: number }> => {
    const phase = await loadResolutionPhase(ctx, { ...args, phase: "finalize" });
    if (phase === null) {
      const game = await ctx.db.get("sim_games", args.gameId);
      return {
        skipped: true,
        resolvedTurn: args.turnNumber,
        nextTurn: game?.currentTurn ?? args.turnNumber,
      };
    }

    const t = args.turnNumber;
    const nextTurn = t + 1;
    await cleanupFleetOrdersForTurn(ctx, {
      gameId: args.gameId,
      turnNumber: t,
    });

    await ctx.db.patch("sim_turns", phase.turn._id, {
      resolvedAt: Date.now(),
      state: "resolved",
      resolutionPhase: undefined,
      resolvingStartedAt: undefined,
    });

    const gameBeforeAdvance = await ctx.db.get("sim_games", args.gameId);
    if (gameBeforeAdvance === null) {
      throw new Error("Game not found.");
    }
    const nextTurnStartedAt = scheduledNextTurnStartedAt({
      turnStartedAtMs: phase.turn.startedAt,
      turnDurationMs: gameBeforeAdvance.turnDurationMs,
    });
    const scheduledRatio = gameBeforeAdvance.nextTurnAutoResolveDelayRatio;
    const gamePatch: {
      currentTurn: number;
      nextTurnAutoResolveDelayRatio?: undefined;
      turnPausedUntilMs?: number;
    } = { currentTurn: nextTurn };
    if (scheduledRatio !== undefined && Number.isFinite(scheduledRatio)) {
      gamePatch.nextTurnAutoResolveDelayRatio = undefined;
      const r = Math.max(0, Math.min(1, scheduledRatio));
      if (r > 0) {
        const delayMs = Math.round(r * Math.max(1, gameBeforeAdvance.turnDurationMs));
        gamePatch.turnPausedUntilMs = nextTurnStartedAt + delayMs;
      } else {
        gamePatch.turnPausedUntilMs = undefined;
      }
    }
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

    return { skipped: false, resolvedTurn: t, nextTurn };
  },
});

export const resolveTurn = internalMutation({
  args: { gameId: v.id("sim_games") },
  handler: async (ctx, args): Promise<{ resolvedTurn: number; nextTurn: number }> => {
    const game = await ctx.db.get("sim_games", args.gameId);
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
