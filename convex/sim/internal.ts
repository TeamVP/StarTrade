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
  resolveRetreatStrike,
} from "./combat";
import { insertSimEvent } from "./eventLog";
import { applyFleetMoveOrders } from "./fleetOrders";
import { applyGarrisonRoutes } from "./garrisonRoutes";
import { reconcileSystemHolding } from "./systemHoldings";
import { POPULATION_MIN_INHABITED_PEOPLE } from "./economy/population";
import { findLinkBetweenSystems } from "../gal/linkUtils";
import { travelTurnsFromLinkCost } from "./fleetDispatch";

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
    .take(200);

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

function chooseAttacker(groups: FleetGroup[], defenderEmpireId: Id<"emp_states">) {
  return [...groups]
    .filter((group) => group.empireId !== defenderEmpireId)
    .sort((a, b) => b.ships - a.ships)[0];
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

async function applyMothershipPriorityToRound(
  ctx: MutationCtx,
  params: {
    gameId: Id<"sim_games">;
    systemId: Id<"gal_systems">;
    attackerEmpireId: Id<"emp_states">;
    defenderEmpireId: Id<"emp_states">;
    round: BattleRoundResult;
  },
): Promise<{ round: BattleRoundResult; events: MothershipDamageEvent[] }> {
  const attackerDamage = await applyMothershipPriorityDamage(ctx, {
    gameId: params.gameId,
    systemId: params.systemId,
    empireId: params.attackerEmpireId,
    side: "attacker",
    incomingLosses: params.round.attackerLosses,
  });
  const defenderDamage = await applyMothershipPriorityDamage(ctx, {
    gameId: params.gameId,
    systemId: params.systemId,
    empireId: params.defenderEmpireId,
    side: "defender",
    incomingLosses: params.round.defenderLosses,
  });

  const attackerLosses = Math.min(
    params.round.attackerShipsBefore,
    attackerDamage.fleetLosses,
  );
  const defenderLosses = Math.min(
    params.round.defenderShipsBefore,
    defenderDamage.fleetLosses,
  );

  return {
    round: {
      ...params.round,
      attackerLosses,
      defenderLosses,
      attackerShipsAfter: params.round.attackerShipsBefore - attackerLosses,
      defenderShipsAfter: params.round.defenderShipsBefore - defenderLosses,
    },
    events: [...attackerDamage.events, ...defenderDamage.events],
  };
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
    eventType: "system_conquered" | "system_held" | "battle_retreat_succeeded";
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
      ownerEmpireId:
        params.eventType === "battle_retreat_succeeded"
          ? params.system.ownerEmpireId
          : params.winnerEmpireId,
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
  const retreatOrders = new Set(
    params.orders
      .filter((order) => order.orderType === "retreat")
      .map((order) => order.fleetId as string),
  );

  for (const battle of battles) {
    let system = await ctx.db.get("gal_systems", battle.systemId);
    const attacker = await ctx.db.get("flt_fleets", battle.attackerFleetId);
    const defender = await ctx.db.get("flt_fleets", battle.defenderFleetId);
    if (system === null || attacker === null || defender === null) {
      if (attacker !== null && attacker.status === "engaged") {
        await ctx.db.patch("flt_fleets", attacker._id, {
          status: "idle",
        });
      }
      if (defender !== null && defender.status === "engaged") {
        await ctx.db.patch("flt_fleets", defender._id, {
          status: "idle",
        });
      }
      await ctx.db.patch("cmb_battles", battle._id, {
        status: "resolved",
        phase: "resolved",
        updatedTurn: params.turnNumber,
      });
      continue;
    }

    const isDefenderHomeworld =
      system.isHomeworld && system.ownerEmpireId === battle.defenderEmpireId;

    if (retreatOrders.has(battle.attackerFleetId)) {
      const rawRound = resolveRetreatStrike({
        attackerShips: attacker.strength,
        defenderShips: defender.strength,
        isDefenderHomeworld,
        roundNumber: battle.roundNumber + 1,
        multipliers: params.combatMultipliers,
      });
      const adjusted = await applyMothershipPriorityToRound(ctx, {
        gameId: params.gameId,
        systemId: system._id,
        attackerEmpireId: battle.attackerEmpireId,
        defenderEmpireId: battle.defenderEmpireId,
        round: rawRound,
      });
      const round = adjusted.round;
      await writeBattleRoundEvents(ctx, {
        gameId: params.gameId,
        turnNumber: params.turnNumber,
        battleId: battle._id,
        system,
        attacker: {
          empireId: battle.attackerEmpireId,
          fleets: [attacker],
          ships: attacker.strength,
        },
        defender: {
          empireId: battle.defenderEmpireId,
          fleets: [defender],
          ships: defender.strength,
        },
        rounds: [round],
        mothershipEvents: adjusted.events,
      });

      if (round.attackerShipsAfter <= 0) {
        await ctx.db.delete("flt_fleets", attacker._id);
        await ctx.db.patch("flt_fleets", defender._id, { status: "idle" });
        await finishBattle(ctx, {
          battle,
          system,
          eventTurn: params.turnNumber,
          winnerEmpireId: battle.defenderEmpireId,
          winnerFleetId: defender._id,
          eventType: "system_held",
          summary: `${system.name}: retreat failed and defenders destroyed the attackers`,
          payload: {
            winnerEmpireId: battle.defenderEmpireId,
            attackerEmpireId: battle.attackerEmpireId,
            retreatSucceeded: false,
          },
        });
      } else {
        await ctx.db.patch("flt_fleets", attacker._id, {
          strength: round.attackerShipsAfter,
          originSystemId: battle.retreatTargetSystemId,
          status: "idle",
        });
        await ctx.db.patch("flt_fleets", defender._id, { status: "idle" });
        await finishBattle(ctx, {
          battle,
          system,
          eventTurn: params.turnNumber,
          winnerEmpireId: battle.defenderEmpireId,
          winnerFleetId: defender._id,
          eventType: "battle_retreat_succeeded",
          summary: `${system.name}: attackers escaped after losing ${round.attackerLosses} ships during retreat`,
          payload: {
            defenderEmpireId: battle.defenderEmpireId,
            attackerEmpireId: battle.attackerEmpireId,
            retreatTargetSystemId: battle.retreatTargetSystemId,
            retreatingShips: round.attackerShipsAfter,
          },
        });
      }
      continue;
    }

    const fullRound = resolveFullCombatRound({
      attackerShips: attacker.strength,
      defenderShips: defender.strength,
      seed: params.seed,
      systemId: system._id,
      turnNumber: params.turnNumber,
      attackerEmpireId: battle.attackerEmpireId,
      defenderEmpireId: battle.defenderEmpireId,
      roundNumber: battle.roundNumber + 1,
      isDefenderHomeworld,
      collateralState: systemCollateralState(system),
      multipliers: params.combatMultipliers,
    });
    const adjusted = await applyMothershipPriorityToRound(ctx, {
      gameId: params.gameId,
      systemId: system._id,
      attackerEmpireId: battle.attackerEmpireId,
      defenderEmpireId: battle.defenderEmpireId,
      round: fullRound.round,
    });
    const round = adjusted.round;

    await writeBattleRoundEvents(ctx, {
      gameId: params.gameId,
      turnNumber: params.turnNumber,
      battleId: battle._id,
      system,
      attacker: {
        empireId: battle.attackerEmpireId,
        fleets: [attacker],
        ships: attacker.strength,
      },
      defender: {
        empireId: battle.defenderEmpireId,
        fleets: [defender],
        ships: defender.strength,
      },
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

    if (round.attackerShipsAfter <= 0) {
      await ctx.db.delete("flt_fleets", attacker._id);
    } else {
      await ctx.db.patch("flt_fleets", attacker._id, {
        strength: round.attackerShipsAfter,
      });
    }

    if (round.defenderShipsAfter <= 0) {
      await ctx.db.delete("flt_fleets", defender._id);
    } else {
      await ctx.db.patch("flt_fleets", defender._id, {
        strength: round.defenderShipsAfter,
      });
    }

    if (
      round.attackerShipsAfter > 0 &&
      round.defenderShipsAfter <= 0
    ) {
      await ctx.db.patch("flt_fleets", attacker._id, { status: "idle" });
      await finishBattle(ctx, {
        battle,
        system,
        eventTurn: params.turnNumber,
        winnerEmpireId: battle.attackerEmpireId,
        winnerFleetId: attacker._id,
        eventType: "system_conquered",
        summary: `${system.name} was conquered after round ${round.roundNumber}`,
        payload: {
          winnerEmpireId: battle.attackerEmpireId,
          previousOwnerEmpireId: battle.originalOwnerEmpireId,
          survivingShips: round.attackerShipsAfter,
        },
      });
    } else if (
      round.defenderShipsAfter > 0 &&
      round.attackerShipsAfter <= 0
    ) {
      await ctx.db.patch("flt_fleets", defender._id, { status: "idle" });
      await finishBattle(ctx, {
        battle,
        system,
        eventTurn: params.turnNumber,
        winnerEmpireId: battle.defenderEmpireId,
        winnerFleetId: defender._id,
        eventType: "system_held",
        summary: `${system.name} held after attackers were destroyed`,
        payload: {
          winnerEmpireId: battle.defenderEmpireId,
          attackerEmpireId: battle.attackerEmpireId,
          survivingShips: round.defenderShipsAfter,
        },
      });
    } else if (
      round.attackerShipsAfter <= 0 &&
      round.defenderShipsAfter <= 0
    ) {
      await finishBattle(ctx, {
        battle,
        system,
        eventTurn: params.turnNumber,
        winnerEmpireId: null,
        winnerFleetId: null,
        eventType: "system_held",
        summary: `${system.name}: both battle fleets were destroyed`,
        payload: {
          attackerEmpireId: battle.attackerEmpireId,
          defenderEmpireId: battle.defenderEmpireId,
        },
      });
    } else {
      await ctx.db.patch("cmb_battles", battle._id, {
        phase: "awaitingAttackerDecision",
        roundNumber: round.roundNumber,
        updatedTurn: params.turnNumber,
      });
      await ctx.db.patch("gal_systems", system._id, {
        underAttack: true,
        lastContestedTurn: params.turnNumber,
      });
    }
  }

  for (const order of params.orders) {
    if (order.orderType === "retreat") {
      await ctx.db.delete("flt_orders", order._id);
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

  const bySystem = new Map<string, Doc<"flt_fleets">[]>();
  for (const fleet of fleets) {
    if (fleet.strength <= 0) continue;
    const list = bySystem.get(fleet.originSystemId) ?? [];
    list.push(fleet);
    bySystem.set(fleet.originSystemId, list);
  }

  for (const [systemId, systemFleets] of bySystem) {
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

    const defender = chooseDefender(groups, system.ownerEmpireId);
    const attacker = chooseAttacker(groups, defender.empireId);
    if (attacker === undefined) continue;

    const attackerFleet = await mergeFleetGroupForBattle(ctx, attacker);
    const defenderFleet = await mergeFleetGroupForBattle(ctx, defender);
    const battleId = await ctx.db.insert("cmb_battles", {
      gameId: params.gameId,
      systemId: system._id,
      attackerEmpireId: attacker.empireId,
      defenderEmpireId: defender.empireId,
      attackerFleetId: attackerFleet._id,
      defenderFleetId: defenderFleet._id,
      originalOwnerEmpireId: system.ownerEmpireId,
      retreatTargetSystemId: attackerFleet.retreatSystemId ?? system._id,
      status: "active",
      phase: "opening",
      roundNumber: 0,
      startedTurn: params.turnNumber,
      updatedTurn: params.turnNumber,
    });
    await ctx.db.patch("flt_fleets", attackerFleet._id, {
      status: "engaged",
      activeBattleId: battleId,
    });
    await ctx.db.patch("flt_fleets", defenderFleet._id, {
      status: "engaged",
      activeBattleId: battleId,
    });
    await ctx.db.patch("gal_systems", system._id, {
      underAttack: true,
      lastContestedTurn: params.turnNumber,
    });

    const attackerMotherships = await loadIdleMothershipTargets(ctx, {
      gameId: params.gameId,
      systemId: system._id,
      empireId: attacker.empireId,
    });
    const defenderMotherships = await loadIdleMothershipTargets(ctx, {
      gameId: params.gameId,
      systemId: system._id,
      empireId: defender.empireId,
    });

    await insertSimEvent(ctx, {
      gameId: params.gameId,
      turnNumber: params.turnNumber,
      eventType: "battle_started",
      actorType: "empire",
      actorId: attacker.empireId,
      targetType: "system",
      targetId: system._id,
      summary: `${system.name}: ${attacker.ships} attacking ships engaged ${defender.ships} defenders`,
      payload: {
        battleId,
        systemId: system._id,
        attackerEmpireId: attacker.empireId,
        defenderEmpireId: defender.empireId,
        attackerShips: attacker.ships,
        defenderShips: defender.ships,
        attackerMotherships: attackerMotherships.length,
        defenderMotherships: defenderMotherships.length,
      },
    });

    const rawOpening = resolveOpeningStrike({
      attackerShips: attacker.ships,
      defenderShips: defender.ships,
      isDefenderHomeworld:
        system.isHomeworld && system.ownerEmpireId === defender.empireId,
      multipliers: params.combatMultipliers,
    });
    const adjusted = await applyMothershipPriorityToRound(ctx, {
      gameId: params.gameId,
      systemId: system._id,
      attackerEmpireId: attacker.empireId,
      defenderEmpireId: defender.empireId,
      round: rawOpening,
    });
    const opening = adjusted.round;
    await writeBattleRoundEvents(ctx, {
      gameId: params.gameId,
      turnNumber: params.turnNumber,
      battleId,
      system,
      attacker,
      defender,
      rounds: [opening],
      mothershipEvents: adjusted.events,
    });

    if (opening.attackerShipsAfter <= 0) {
      await ctx.db.delete("flt_fleets", attackerFleet._id);
      await ctx.db.patch("flt_fleets", defenderFleet._id, { status: "idle" });
      const battle = await ctx.db.get("cmb_battles", battleId);
      if (battle !== null) {
        await finishBattle(ctx, {
          battle,
          system,
          eventTurn: params.turnNumber,
          winnerEmpireId: defender.empireId,
          winnerFleetId: defenderFleet._id,
          eventType: "system_held",
          summary: `${system.name} held after the opening defensive strike`,
          payload: {
            winnerEmpireId: defender.empireId,
            attackerEmpireId: attacker.empireId,
            survivingShips: defender.ships,
          },
        });
      }
    } else {
      await ctx.db.patch("flt_fleets", attackerFleet._id, {
        strength: opening.attackerShipsAfter,
      });
      await ctx.db.patch("cmb_battles", battleId, {
        phase: "awaitingAttackerDecision",
        updatedTurn: params.turnNumber,
      });
      await insertSimEvent(ctx, {
        gameId: params.gameId,
        turnNumber: params.turnNumber,
        eventType: "battle_awaiting_retreat_decision",
        actorType: "empire",
        actorId: attacker.empireId,
        targetType: "system",
        targetId: system._id,
        summary: `${system.name}: attackers survived opening fire and may retreat this turn`,
        payload: {
          battleId,
          systemId: system._id,
          attackerFleetId: attackerFleet._id,
          attackerEmpireId: attacker.empireId,
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

    const turnNumber = game.currentTurn;
    const now = Date.now();
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
    await ctx.db.patch("sim_turns", phase.turn._id, {
      resolvedAt: Date.now(),
      state: "resolved",
      resolutionPhase: undefined,
      resolvingStartedAt: undefined,
    });

    await ctx.db.patch("sim_games", args.gameId, { currentTurn: nextTurn });

    const existingNextTurn = await loadTurnRow(ctx, args.gameId, nextTurn);
    if (existingNextTurn === null) {
      await ctx.db.insert("sim_turns", {
        gameId: args.gameId,
        turnNumber: nextTurn,
        startedAt: Date.now(),
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
    await ctx.db.patch("sim_games", args.gameId, { currentTurn: nextTurn });

    await ctx.db.insert("sim_turns", {
      gameId: args.gameId,
      turnNumber: nextTurn,
      startedAt: Date.now(),
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
