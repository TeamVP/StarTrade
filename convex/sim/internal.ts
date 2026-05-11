import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { internalMutation } from "../_generated/server";
import { v } from "convex/values";
import { PAUSE_BUDGET_CAP_SECONDS, PAUSE_BUDGET_REFRESH_MS } from "./economy/constants";
import { applyBackgroundTrade } from "./economy/applyBackgroundTrade";
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
  const fleetsSnapshot = await ctx.db
    .query("flt_fleets")
    .withIndex("by_gameId", (q) => q.eq("gameId", gameId))
    .take(128);

  for (const fleet of fleetsSnapshot) {
    if (
      fleet.status === "enRoute" &&
      fleet.etaTurn === turnNumber &&
      fleet.destinationSystemId !== null
    ) {
      const destId = fleet.destinationSystemId;
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
}

async function mergeIdleFleetsAtSameBody(
  ctx: MutationCtx,
  gameId: Id<"sim_games">,
  fleetIdsWithOrdersThisTurn: Set<string>,
): Promise<void> {
  const fleets = await ctx.db
    .query("flt_fleets")
    .withIndex("by_gameId", (q) => q.eq("gameId", gameId))
    .take(128);

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

async function reconcileSystemHolding(
  ctx: MutationCtx,
  params: {
    gameId: Id<"sim_games">;
    systemId: Id<"gal_systems">;
    winnerEmpireId: Id<"emp_states">;
  },
): Promise<void> {
  const holdings = await ctx.db
    .query("emp_system_holdings")
    .withIndex("by_gameId_and_systemId", (q) =>
      q.eq("gameId", params.gameId).eq("systemId", params.systemId),
    )
    .take(16);

  let winnerHasHolding = false;
  for (const holding of holdings) {
    if (holding.empireId === params.winnerEmpireId) {
      winnerHasHolding = true;
    } else {
      await ctx.db.delete("emp_system_holdings", holding._id);
    }
  }

  if (!winnerHasHolding) {
    await ctx.db.insert("emp_system_holdings", {
      gameId: params.gameId,
      empireId: params.winnerEmpireId,
      systemId: params.systemId,
      taxRate: 0.18,
      productionModifier: 1,
      unrest: 0.12,
    });
  }
}

async function writeBattleRoundEvents(
  ctx: MutationCtx,
  params: {
    gameId: Id<"sim_games">;
    turnNumber: number;
    system: Doc<"gal_systems">;
    attacker: FleetGroup;
    defender: FleetGroup;
    rounds: BattleRoundResult[];
  },
): Promise<void> {
  for (const round of params.rounds) {
    await insertSimEvent(ctx, {
      gameId: params.gameId,
      turnNumber: params.turnNumber,
      eventType: "battle_round_resolved",
      actorType: "empire",
      actorId: params.attacker.empireId,
      targetType: "system",
      targetId: params.system._id,
      summary:
        round.phase === "opening"
          ? `${params.system.name}: defenders destroyed ${round.attackerLosses} attacking ships in the opening strike`
          : `${params.system.name}: round ${round.roundNumber} destroyed ${round.attackerLosses} attacker and ${round.defenderLosses} defender ships`,
      payload: {
        systemId: params.system._id,
        attackerEmpireId: params.attacker.empireId,
        defenderEmpireId: params.defender.empireId,
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
      const round = resolveRetreatStrike({
        attackerShips: attacker.strength,
        defenderShips: defender.strength,
        isDefenderHomeworld,
        roundNumber: battle.roundNumber + 1,
        multipliers: params.combatMultipliers,
      });
      await writeBattleRoundEvents(ctx, {
        gameId: params.gameId,
        turnNumber: params.turnNumber,
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

    await writeBattleRoundEvents(ctx, {
      gameId: params.gameId,
      turnNumber: params.turnNumber,
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
      rounds: [fullRound.round],
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

    if (fullRound.round.attackerShipsAfter <= 0) {
      await ctx.db.delete("flt_fleets", attacker._id);
    } else {
      await ctx.db.patch("flt_fleets", attacker._id, {
        strength: fullRound.round.attackerShipsAfter,
      });
    }

    if (fullRound.round.defenderShipsAfter <= 0) {
      await ctx.db.delete("flt_fleets", defender._id);
    } else {
      await ctx.db.patch("flt_fleets", defender._id, {
        strength: fullRound.round.defenderShipsAfter,
      });
    }

    if (
      fullRound.round.attackerShipsAfter > 0 &&
      fullRound.round.defenderShipsAfter <= 0
    ) {
      await ctx.db.patch("flt_fleets", attacker._id, { status: "idle" });
      await finishBattle(ctx, {
        battle,
        system,
        eventTurn: params.turnNumber,
        winnerEmpireId: battle.attackerEmpireId,
        winnerFleetId: attacker._id,
        eventType: "system_conquered",
        summary: `${system.name} was conquered after round ${fullRound.round.roundNumber}`,
        payload: {
          winnerEmpireId: battle.attackerEmpireId,
          previousOwnerEmpireId: battle.originalOwnerEmpireId,
          survivingShips: fullRound.round.attackerShipsAfter,
        },
      });
    } else if (
      fullRound.round.defenderShipsAfter > 0 &&
      fullRound.round.attackerShipsAfter <= 0
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
          survivingShips: fullRound.round.defenderShipsAfter,
        },
      });
    } else if (
      fullRound.round.attackerShipsAfter <= 0 &&
      fullRound.round.defenderShipsAfter <= 0
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
        roundNumber: fullRound.round.roundNumber,
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
  const fleets = await ctx.db
    .query("flt_fleets")
    .withIndex("by_gameId", (q) => q.eq("gameId", params.gameId))
    .take(128);

  const bySystem = new Map<string, Doc<"flt_fleets">[]>();
  for (const fleet of fleets) {
    if (fleet.status !== "idle" || fleet.strength <= 0) continue;
    const list = bySystem.get(fleet.originSystemId) ?? [];
    list.push(fleet);
    bySystem.set(fleet.originSystemId, list);
  }

  for (const [systemId, systemFleets] of bySystem) {
    const groups = groupIdleFleetsByEmpire(systemFleets);
    const system = await ctx.db.get("gal_systems", systemId as Id<"gal_systems">);
    if (system === null) continue;

    if (groups.length < 2) {
      if (groups.length === 1 && system.ownerEmpireId !== groups[0].empireId) {
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
      },
    });

    const opening = resolveOpeningStrike({
      attackerShips: attacker.ships,
      defenderShips: defender.ships,
      isDefenderHomeworld:
        system.isHomeworld && system.ownerEmpireId === defender.empireId,
      multipliers: params.combatMultipliers,
    });
    await writeBattleRoundEvents(ctx, {
      gameId: params.gameId,
      turnNumber: params.turnNumber,
      system,
      attacker,
      defender,
      rounds: [opening],
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

    await applyGarrisonRoutes(ctx, {
      gameId: args.gameId,
      turnNumber: t,
    });

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
