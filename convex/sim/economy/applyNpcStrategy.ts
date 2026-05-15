import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx } from "../../_generated/server";
import { internalMutation } from "../../_generated/server";
import { v } from "convex/values";
import {
  applyGarrisonRoutes,
  idleFleetsAtSystemForEmpire,
  shipsToDispatchFromPct,
} from "../garrisonRoutes";
import { dispatchMoveFromFleet } from "../fleetDispatch";
import {
  cleanupFleetOrdersForTurn,
  hasManualOrderOriginLock,
  loadManualOrderOriginLocks,
} from "../fleetOrders";
import { FOOD_PER_POP } from "./constants";
import { populationToSimUnits } from "./population";
import {
  buildRuntimeStrategyAutomation,
  computeStrategicSliderDefaults,
  resolveStrategicSliders,
  type PriorityStarPolicy,
  type RuntimeStrategyAutomation,
} from "./strategicSliders";

export type { PriorityStarPolicy } from "./strategicSliders";

type StrategyEconomy = {
  taxRateTarget?: number;
  emphasisFood?: number;
  emphasisShips?: number;
  emphasisResearch?: number;
  foodSubsidyEnabled?: boolean;
  foodSubsidyPerUnit?: number;
  foodShortageResponse: FoodShortageResponse;
};

type NeutralWorldPriority = "nearest" | "richest" | "weakestDefended";
type BorderStance = "passive" | "defensive" | "balanced" | "aggressive" | "warlike";
type StrategyPurpose =
  | "emergencyReinforce"
  /** Owned-only standing orders hop toward the nearest reachable marked Priority star you control. */
  | "priorityOwnedCorridor"
  | "priorityNeutralTarget"
  | "priorityEnemyStaging"
  | "priorityEnemyAttack"
  | "priorityApproach"
  | "earlyRush"
  | "borderReinforce"
  | "enemyAttack";

const STANDING_ORDER_PURPOSE_PRECEDENCE: Record<StrategyPurpose, number> = {
  emergencyReinforce: 100,
  /** Keep frontier conquest from being replaced by interior corridor routing. */
  priorityApproach: 94,
  priorityOwnedCorridor: 91,
  priorityEnemyAttack: 89,
  priorityNeutralTarget: 88,
  priorityEnemyStaging: 85,
  earlyRush: 60,
  enemyAttack: 55,
  borderReinforce: 45,
};

export type FoodShortageResponse = {
  enabled: boolean;
  shiftPctPerTurn: number;
  minShipsPct: number;
  maxFoodPct: number;
  recoveryTurns: number;
};

export type StrategyAutomation = {
  earlyRush: boolean;
  neutralWorldPriority: NeutralWorldPriority;
  reserveShipsPct: number;
  priorityStarPolicy: PriorityStarPolicy;
  reinforceAttackedSystems: boolean;
  emergencyReserveShipsPct: number;
  moveDeepFleetsToBorder: boolean;
  borderReserveShipsPct: number;
  stance: BorderStance;
  attackAdvantageRequired: number;
};

type DesiredRoute = {
  originSystemId: Id<"gal_systems">;
  destinationSystemId: Id<"gal_systems">;
  dispatchPct: number;
  purpose: StrategyPurpose;
};

const DEFAULT_FOOD_SHORTAGE_SHIFT_PCT_PER_TURN = 15;
const DEFAULT_EMERGENCY_RESERVE_SHIPS_PCT = 20;
const MAX_ATTACK_ADVANTAGE_REQUIRED = 999;

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function readString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function readBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function foodStockpileMeetsTurns(system: Doc<"gal_systems">, minTurns: number): boolean {
  if (minTurns <= 0) return true;
  const pop = Math.max(0, system.population ?? 0);
  if (pop <= 0) return false;
  const demand = populationToSimUnits(pop) * FOOD_PER_POP;
  return (system.stockFood ?? 0) >= demand * minTurns;
}

function parseStrategy(strategyJson: string): Record<string, unknown> | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(strategyJson);
  } catch {
    return null;
  }
  return asRecord(parsed);
}

export function applyFoodShortageProductionShift(params: {
  baseFoodPct: number;
  baseShipsPct: number;
  baseResearchPct: number;
  shortageTurns: number;
  lastShortageTurn?: number;
  lastShortageTurns?: number;
  currentTurn?: number;
  response: FoodShortageResponse;
}): { emphasisFood: number; emphasisShips: number; emphasisResearch: number } {
  const baseFood = clamp(Math.round(params.baseFoodPct), 0, 100);
  const baseShips = clamp(Math.round(params.baseShipsPct), 0, 100);
  const baseResearch = clamp(Math.round(params.baseResearchPct), 0, 100);
  const recoveryTurns = Math.floor(params.response.recoveryTurns);
  const turnsSinceLastShortage =
    params.currentTurn !== undefined && params.lastShortageTurn !== undefined
      ? params.currentTurn - params.lastShortageTurn
      : Number.POSITIVE_INFINITY;
  const effectiveShortageTurns =
    params.shortageTurns > 0
      ? params.shortageTurns
      : recoveryTurns > 0 &&
          turnsSinceLastShortage > 0 &&
          turnsSinceLastShortage <= recoveryTurns
        ? (params.lastShortageTurns ?? 0)
        : 0;

  if (!params.response.enabled || effectiveShortageTurns <= 0) {
    return {
      emphasisFood: baseFood,
      emphasisShips: baseShips,
      emphasisResearch: baseResearch,
    };
  }

  const requestedShift = Math.round(params.response.shiftPctPerTurn * effectiveShortageTurns);
  const availableShips = Math.max(0, baseShips - params.response.minShipsPct);
  const availableFoodRoom = Math.max(0, params.response.maxFoodPct - baseFood);
  const appliedShift = Math.min(requestedShift, availableShips, availableFoodRoom);

  return {
    emphasisFood: baseFood + appliedShift,
    emphasisShips: baseShips - appliedShift,
    emphasisResearch: baseResearch,
  };
}

export function applyShipProductionBoost(params: {
  baseFoodPct: number;
  baseShipsPct: number;
  baseResearchPct: number;
  boostPct: number;
}): { emphasisFood: number; emphasisShips: number; emphasisResearch: number } {
  const baseFood = clamp(Math.round(params.baseFoodPct), 0, 100);
  const baseShips = clamp(Math.round(params.baseShipsPct), 0, 100);
  const baseResearch = clamp(Math.round(params.baseResearchPct), 0, 100);
  const maxShips = Math.max(0, 100 - baseResearch);
  const boost = Math.min(
    Math.max(0, Math.round(params.boostPct)),
    baseFood,
    Math.max(0, maxShips - baseShips),
  );

  return {
    emphasisFood: baseFood - boost,
    emphasisShips: baseShips + boost,
    emphasisResearch: baseResearch,
  };
}

function parseEconomy(strategyJson: string): StrategyEconomy | null {
  const strategy = parseStrategy(strategyJson);
  const rawEconomy = strategy === null ? null : asRecord(strategy.economy);
  if (rawEconomy === null) {
    return null;
  }

  const rawFoodShortageResponse =
    asRecord(rawEconomy.foodShortageResponse) ?? asRecord(strategy?.foodShortageResponse);

  return {
    taxRateTarget: finiteNumber(rawEconomy.taxRateTarget) ?? undefined,
    emphasisFood: finiteNumber(rawEconomy.emphasisFood) ?? undefined,
    emphasisShips: finiteNumber(rawEconomy.emphasisShips) ?? undefined,
    emphasisResearch: finiteNumber(rawEconomy.emphasisResearch) ?? undefined,
    foodSubsidyEnabled:
      typeof rawEconomy.foodSubsidyEnabled === "boolean"
        ? rawEconomy.foodSubsidyEnabled
        : undefined,
    foodSubsidyPerUnit: finiteNumber(rawEconomy.foodSubsidyPerUnit) ?? undefined,
    foodShortageResponse: {
      enabled: readBoolean(rawFoodShortageResponse?.enabled) ?? true,
      shiftPctPerTurn: clamp(
        finiteNumber(rawFoodShortageResponse?.shiftPctPerTurn) ??
          finiteNumber(rawEconomy.foodShortageShiftPctPerTurn) ??
          finiteNumber(rawEconomy.foodShortageShiftPct) ??
          DEFAULT_FOOD_SHORTAGE_SHIFT_PCT_PER_TURN,
        0,
        100,
      ),
      minShipsPct: clamp(finiteNumber(rawFoodShortageResponse?.minShipsPct) ?? 0, 0, 100),
      maxFoodPct: clamp(finiteNumber(rawFoodShortageResponse?.maxFoodPct) ?? 100, 0, 100),
      recoveryTurns: clamp(
        finiteNumber(rawFoodShortageResponse?.recoveryTurns) ??
          finiteNumber(rawFoodShortageResponse?.lingerTurns) ??
          finiteNumber(rawFoodShortageResponse?.holdTurnsAfterRecovery) ??
          0,
        0,
        100,
      ),
    },
  };
}

export function parseAutomation(strategyJson: string): StrategyAutomation | null {
  const strategy = parseStrategy(strategyJson);
  if (strategy === null) {
    return null;
  }

  const expansion = asRecord(strategy.expansion) ?? {};
  const fleetPosture = asRecord(strategy.fleetPosture) ?? {};
  const borderPolicy = asRecord(strategy.borderPolicy) ?? {};
  const military = asRecord(strategy.military) ?? {};
  const defense = asRecord(strategy.defense) ?? {};
  const priorityStarPolicyRaw =
    asRecord(strategy.priorityStarPolicy) ??
    asRecord(strategy.priorityStars) ??
    asRecord(fleetPosture.priorityStarPolicy) ??
    {};

  const neutralWorldPriority = readString(expansion.neutralWorldPriority);
  const rawStance = readString(borderPolicy.stance) ?? readString(military.aggressionLevel);
  const stance: BorderStance =
    rawStance === "passive" ||
    rawStance === "defensive" ||
    rawStance === "balanced" ||
    rawStance === "aggressive" ||
    rawStance === "warlike"
      ? rawStance
      : "balanced";

  const defaultAttackAdvantage =
    stance === "warlike" ? 0.8 : stance === "aggressive" ? 1 : stance === "balanced" ? 4 : 999;
  const rawAttackAdvantage = finiteNumber(borderPolicy.attackAdvantageRequired);

  return {
    earlyRush:
      readBoolean(expansion.earlyRush) ??
      readBoolean(expansion.colonizationEnabled) ??
      false,
    neutralWorldPriority:
      neutralWorldPriority === "richest" ||
      neutralWorldPriority === "weakestDefended" ||
      neutralWorldPriority === "nearest"
        ? neutralWorldPriority
        : "nearest",
    reserveShipsPct: clamp(finiteNumber(expansion.reserveShipsPct) ?? 30, 0, 95),
    priorityStarPolicy: {
      enabled: readBoolean(priorityStarPolicyRaw.enabled) ?? true,
      neutralDispatchPct: clamp(
        finiteNumber(priorityStarPolicyRaw.neutralDispatchPct) ?? 85,
        1,
        100,
      ),
      stagingDispatchPct: clamp(
        finiteNumber(priorityStarPolicyRaw.stagingDispatchPct) ?? 80,
        1,
        100,
      ),
      enemyDispatchPct: clamp(
        finiteNumber(priorityStarPolicyRaw.enemyDispatchPct) ?? 80,
        1,
        100,
      ),
      approachDispatchPct: clamp(
        finiteNumber(priorityStarPolicyRaw.approachDispatchPct) ?? 85,
        1,
        100,
      ),
      enemyAttackAdvantageRequired:
        finiteNumber(priorityStarPolicyRaw.enemyAttackAdvantageRequired) ?? undefined,
      minDefenseAverageFleetMult: clamp(
        finiteNumber(priorityStarPolicyRaw.minDefenseAverageFleetMult) ?? 1,
        0,
        5,
      ),
      shipBoostPct: clamp(
        finiteNumber(priorityStarPolicyRaw.shipBoostPct) ??
          finiteNumber(priorityStarPolicyRaw.shipProductionBoostPct) ??
          0,
        0,
        100,
      ),
      minFoodStockpileTurns: clamp(
        finiteNumber(priorityStarPolicyRaw.minFoodStockpileTurns) ??
          finiteNumber(priorityStarPolicyRaw.foodStockpileMinimumTurns) ??
          2,
        0,
        100,
      ),
      ownedCorridorStandingOrdersEnabled:
        readBoolean(priorityStarPolicyRaw.ownedCorridorStandingOrdersEnabled) ??
        readBoolean(priorityStarPolicyRaw.ownedCorridorStandingOrders) ??
        false,
      ownedCorridorDispatchPct: clamp(
        finiteNumber(priorityStarPolicyRaw.ownedCorridorDispatchPct) ??
          finiteNumber(priorityStarPolicyRaw.corridorDispatchPct) ??
          finiteNumber(priorityStarPolicyRaw.stagingDispatchPct) ??
          80,
        1,
        100,
      ),
    },
    reinforceAttackedSystems:
      readBoolean(fleetPosture.reinforceAttackedSystems) ??
      readBoolean(defense.reinforceAttackedSystems) ??
      true,
    emergencyReserveShipsPct: clamp(
      finiteNumber(fleetPosture.emergencyReserveShipsPct) ??
        finiteNumber(defense.emergencyReserveShipsPct) ??
        Math.min(
          finiteNumber(fleetPosture.borderReserveShipsPct) ?? 40,
          DEFAULT_EMERGENCY_RESERVE_SHIPS_PCT,
        ),
      0,
      95,
    ),
    moveDeepFleetsToBorder: readBoolean(fleetPosture.moveDeepFleetsToBorder) ?? true,
    borderReserveShipsPct: clamp(
      finiteNumber(fleetPosture.borderReserveShipsPct) ?? 40,
      0,
      95,
    ),
    stance,
    attackAdvantageRequired: clamp(
      rawAttackAdvantage ?? defaultAttackAdvantage,
      0.5,
      MAX_ATTACK_ADVANTAGE_REQUIRED,
    ),
  };
}

async function applyEconomyStrategyToEmpire(
  ctx: MutationCtx,
  params: {
    gameId: Id<"sim_games">;
    turnNumber: number;
    empire: Doc<"emp_states">;
    economy: StrategyEconomy;
    ownedSystems: Doc<"gal_systems">[];
    priorityStarPolicy?: PriorityStarPolicy;
    priorityStarObjectiveActive: boolean;
  },
): Promise<void> {
  const empirePatch: { empireTaxRate?: number } = {};
  if (params.economy.taxRateTarget !== undefined) {
    const nextTaxRate = clamp(params.economy.taxRateTarget, 0, 0.3);
    if (params.empire.empireTaxRate !== nextTaxRate) {
      empirePatch.empireTaxRate = nextTaxRate;
    }
  }
  if (empirePatch.empireTaxRate !== undefined) {
    await ctx.db.patch("emp_states", params.empire._id, empirePatch);
  }

  for (const system of params.ownedSystems) {
    const patch: {
      emphasisFood?: number;
      emphasisShips?: number;
      emphasisResearch?: number;
      foodImportSubsidyPerUnit?: number;
    } = {};

    const baseFood = params.economy.emphasisFood ?? system.emphasisFood ?? 34;
    const baseShips = params.economy.emphasisShips ?? system.emphasisShips ?? 33;
    const baseResearch = params.economy.emphasisResearch ?? system.emphasisResearch ?? 33;
    const shifted = applyFoodShortageProductionShift({
      baseFoodPct: baseFood,
      baseShipsPct: baseShips,
      baseResearchPct: baseResearch,
      shortageTurns: system.foodShortageTurns ?? 0,
      lastShortageTurn: system.lastFoodShortageTurn,
      lastShortageTurns: system.lastFoodShortageTurns,
      currentTurn: params.turnNumber,
      response: params.economy.foodShortageResponse,
    });

    let finalMix = shifted;
    let dynamicResponseActive =
      shifted.emphasisFood !== clamp(Math.round(baseFood), 0, 100) ||
      shifted.emphasisShips !== clamp(Math.round(baseShips), 0, 100) ||
      shifted.emphasisResearch !== clamp(Math.round(baseResearch), 0, 100);
    const priorityStarPolicy = params.priorityStarPolicy;
    if (
      !dynamicResponseActive &&
      params.priorityStarObjectiveActive &&
      priorityStarPolicy !== undefined &&
      priorityStarPolicy.shipBoostPct > 0 &&
      foodStockpileMeetsTurns(system, priorityStarPolicy.minFoodStockpileTurns)
    ) {
      finalMix = applyShipProductionBoost({
        baseFoodPct: shifted.emphasisFood,
        baseShipsPct: shifted.emphasisShips,
        baseResearchPct: shifted.emphasisResearch,
        boostPct: priorityStarPolicy.shipBoostPct,
      });
      dynamicResponseActive =
        finalMix.emphasisFood !== clamp(Math.round(baseFood), 0, 100) ||
        finalMix.emphasisShips !== clamp(Math.round(baseShips), 0, 100) ||
        finalMix.emphasisResearch !== clamp(Math.round(baseResearch), 0, 100);
    }

    if (
      (params.economy.emphasisFood !== undefined || dynamicResponseActive) &&
      system.emphasisFood !== finalMix.emphasisFood
    ) {
      patch.emphasisFood = finalMix.emphasisFood;
    }
    if (
      (params.economy.emphasisShips !== undefined || dynamicResponseActive) &&
      system.emphasisShips !== finalMix.emphasisShips
    ) {
      patch.emphasisShips = finalMix.emphasisShips;
    }
    if (
      params.economy.emphasisResearch !== undefined &&
      system.emphasisResearch !== finalMix.emphasisResearch
    ) {
      patch.emphasisResearch = finalMix.emphasisResearch;
    }
    if (
      params.economy.foodSubsidyEnabled !== undefined &&
      system.foodImportSubsidyPerUnit !==
        (params.economy.foodSubsidyEnabled
          ? clamp(params.economy.foodSubsidyPerUnit ?? 0, 0, 1_000)
          : 0)
    ) {
      patch.foodImportSubsidyPerUnit = params.economy.foodSubsidyEnabled
        ? clamp(params.economy.foodSubsidyPerUnit ?? 0, 0, 1_000)
        : 0;
    }
    if (Object.keys(patch).length > 0) {
      await ctx.db.patch("gal_systems", system._id, patch);
    }
  }
}

function addAdjacency(
  adjacency: Map<string, Id<"gal_systems">[]>,
  from: Id<"gal_systems">,
  to: Id<"gal_systems">,
) {
  const existing = adjacency.get(from);
  if (existing === undefined) {
    adjacency.set(from, [to]);
  } else {
    existing.push(to);
  }
}

function buildAdjacency(links: Doc<"gal_links">[]): Map<string, Id<"gal_systems">[]> {
  const adjacency = new Map<string, Id<"gal_systems">[]>();
  for (const link of links) {
    addAdjacency(adjacency, link.fromSystemId, link.toSystemId);
    addAdjacency(adjacency, link.toSystemId, link.fromSystemId);
  }
  return adjacency;
}

function systemResourceScore(system: Doc<"gal_systems">): number {
  return system.baseProductivity ?? system.resourceRichness;
}

function fleetStrengthBySystem(
  fleets: Doc<"flt_fleets">[],
): Map<string, Map<string, number>> {
  const bySystem = new Map<string, Map<string, number>>();
  for (const fleet of fleets) {
    if (fleet.status !== "idle" || fleet.strength <= 0) continue;
    let systemMap = bySystem.get(fleet.originSystemId);
    if (systemMap === undefined) {
      systemMap = new Map<string, number>();
      bySystem.set(fleet.originSystemId, systemMap);
    }
    systemMap.set(fleet.empireId, (systemMap.get(fleet.empireId) ?? 0) + fleet.strength);
  }
  return bySystem;
}

function strengthAtSystemForEmpire(
  strengthBySystem: Map<string, Map<string, number>>,
  systemId: Id<"gal_systems">,
  empireId: Id<"emp_states">,
): number {
  return strengthBySystem.get(systemId)?.get(empireId) ?? 0;
}

function totalForeignStrengthAtSystem(
  strengthBySystem: Map<string, Map<string, number>>,
  systemId: Id<"gal_systems">,
  empireId: Id<"emp_states">,
): number {
  const systemMap = strengthBySystem.get(systemId);
  if (systemMap === undefined) return 0;
  let total = 0;
  for (const [otherEmpireId, strength] of systemMap) {
    if (otherEmpireId !== empireId) {
      total += strength;
    }
  }
  return total;
}

function firstHopTowardNearestBorder(params: {
  originSystemId: Id<"gal_systems">;
  borderSystemIds: Set<string>;
  ownedSystemIds: Set<string>;
  adjacency: Map<string, Id<"gal_systems">[]>;
}): Id<"gal_systems"> | null {
  const queue: Array<{ systemId: Id<"gal_systems">; firstHop: Id<"gal_systems"> | null }> = [
    { systemId: params.originSystemId, firstHop: null },
  ];
  const visited = new Set<string>([params.originSystemId]);

  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined) break;
    if (
      current.firstHop !== null &&
      params.borderSystemIds.has(current.systemId)
    ) {
      return current.firstHop;
    }

    const neighbors = params.adjacency.get(current.systemId) ?? [];
    for (const neighborId of neighbors) {
      if (visited.has(neighborId) || !params.ownedSystemIds.has(neighborId)) {
        continue;
      }
      visited.add(neighborId);
      queue.push({
        systemId: neighborId,
        firstHop: current.firstHop ?? neighborId,
      });
    }
  }

  return null;
}

function firstHopTowardNearestTarget(params: {
  originSystemId: Id<"gal_systems">;
  targetSystemIds: Set<string>;
  ownedSystemIds: Set<string>;
  adjacency: Map<string, Id<"gal_systems">[]>;
}): Id<"gal_systems"> | null {
  const queue: Array<{ systemId: Id<"gal_systems">; firstHop: Id<"gal_systems"> | null }> = [
    { systemId: params.originSystemId, firstHop: null },
  ];
  const visited = new Set<string>([params.originSystemId]);

  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined) break;
    if (
      current.firstHop !== null &&
      params.targetSystemIds.has(current.systemId)
    ) {
      return current.firstHop;
    }

    const neighbors = params.adjacency.get(current.systemId) ?? [];
    for (const neighborId of neighbors) {
      if (visited.has(neighborId) || !params.ownedSystemIds.has(neighborId)) {
        continue;
      }
      visited.add(neighborId);
      queue.push({
        systemId: neighborId,
        firstHop: current.firstHop ?? neighborId,
      });
    }
  }

  return null;
}

/** Resolves conflicting standing-order intents at the same origin (higher precedence wins). */
export function mergeStandingOrderCandidates(
  existing: DesiredRoute | undefined,
  incoming: DesiredRoute,
): DesiredRoute {
  if (existing === undefined) return incoming;
  const inc = STANDING_ORDER_PURPOSE_PRECEDENCE[incoming.purpose];
  const cur = STANDING_ORDER_PURPOSE_PRECEDENCE[existing.purpose];
  return inc > cur || (inc === cur && incoming.dispatchPct > existing.dispatchPct)
    ? incoming
    : existing;
}

function putDesiredRoute(
  desired: Map<string, DesiredRoute>,
  route: DesiredRoute,
) {
  const key = route.originSystemId as string;
  desired.set(key, mergeStandingOrderCandidates(desired.get(key), route));
}

function routeEndpointsOwnedByEmpire(params: {
  route: Pick<DesiredRoute, "originSystemId" | "destinationSystemId">;
  systemsById: Map<Id<"gal_systems">, Doc<"gal_systems">>;
  empireId: Id<"emp_states">;
}): boolean {
  const origin = params.systemsById.get(params.route.originSystemId);
  const destination = params.systemsById.get(params.route.destinationSystemId);
  return (
    origin !== undefined &&
    destination !== undefined &&
    origin.ownerEmpireId === params.empireId &&
    destination.ownerEmpireId === params.empireId
  );
}

export function hasManualRouteOverride(
  existingRoutes: Array<
    Pick<Doc<"flt_garrison_routes">, "originSystemId" | "managedByStrategy">
  >,
  originSystemId: Id<"gal_systems">,
): boolean {
  return existingRoutes.some(
    (candidate) =>
      candidate.originSystemId === originSystemId &&
      candidate.managedByStrategy !== true,
  );
}

function findApproachToPriorityStarWithinTwoJumps(params: {
  prioritySystemId: Id<"gal_systems">;
  ownedSystems: Doc<"gal_systems">[];
  adjacency: Map<string, Id<"gal_systems">[]>;
}): { originSystemId: Id<"gal_systems">; nextHopSystemId: Id<"gal_systems"> } | null {
  const ownedSorted = [...params.ownedSystems].sort((a, b) => a._id.localeCompare(b._id));
  let best: {
    originSystemId: Id<"gal_systems">;
    nextHopSystemId: Id<"gal_systems">;
    distance: number;
  } | null = null;

  for (const origin of ownedSorted) {
    const firstHopNeighbors = [...(params.adjacency.get(origin._id) ?? [])].sort();
    for (const firstHop of firstHopNeighbors) {
      if (firstHop === params.prioritySystemId) {
        const candidate = { originSystemId: origin._id, nextHopSystemId: firstHop, distance: 1 };
        if (
          best === null ||
          candidate.distance < best.distance ||
          candidate.originSystemId.localeCompare(best.originSystemId) < 0
        ) {
          best = candidate;
        }
        continue;
      }

      const secondHopNeighbors = [...(params.adjacency.get(firstHop) ?? [])].sort();
      if (secondHopNeighbors.includes(params.prioritySystemId)) {
        const candidate = { originSystemId: origin._id, nextHopSystemId: firstHop, distance: 2 };
        if (
          best === null ||
          candidate.distance < best.distance ||
          candidate.originSystemId.localeCompare(best.originSystemId) < 0
        ) {
          best = candidate;
        }
      }
    }
  }

  return best === null
    ? null
    : { originSystemId: best.originSystemId, nextHopSystemId: best.nextHopSystemId };
}

function hasPriorityStarObjective(params: {
  priorityRows: Doc<"emp_priority_stars">[];
  systemsById: Map<Id<"gal_systems">, Doc<"gal_systems">>;
  ownedSystems: Doc<"gal_systems">[];
  empireId: Id<"emp_states">;
  adjacency: Map<string, Id<"gal_systems">[]>;
}): boolean {
  if (params.priorityRows.length === 0 || params.ownedSystems.length === 0) return false;
  for (const priorityRow of params.priorityRows) {
    const prioritySystem = params.systemsById.get(priorityRow.systemId);
    if (prioritySystem === undefined) continue;
    if (prioritySystem.ownerEmpireId === params.empireId) {
      const neighbors = params.adjacency.get(prioritySystem._id) ?? [];
      if (
        neighbors.some((neighborId) => {
          const neighbor = params.systemsById.get(neighborId);
          return neighbor !== undefined && neighbor.ownerEmpireId !== params.empireId;
        })
      ) {
        return true;
      }
      continue;
    }

    if (
      findApproachToPriorityStarWithinTwoJumps({
        prioritySystemId: prioritySystem._id,
        ownedSystems: params.ownedSystems,
        adjacency: params.adjacency,
      }) !== null
    ) {
      return true;
    }
  }
  return false;
}

async function upsertStrategyRoutes(
  ctx: MutationCtx,
  params: {
    gameId: Id<"sim_games">;
    empireId: Id<"emp_states">;
    turnNumber: number;
    desiredRoutes: DesiredRoute[];
    existingRoutes: Doc<"flt_garrison_routes">[];
    systemsById: Map<Id<"gal_systems">, Doc<"gal_systems">>;
  },
): Promise<void> {
  const desiredByOrigin = new Map(
    params.desiredRoutes.map((route) => [route.originSystemId, route]),
  );

  for (const route of params.existingRoutes) {
    if (route.managedByStrategy !== true) continue;
    if (
      !routeEndpointsOwnedByEmpire({
        route,
        systemsById: params.systemsById,
        empireId: params.empireId,
      })
    ) {
      await ctx.db.delete("flt_garrison_routes", route._id);
      desiredByOrigin.delete(route.originSystemId);
      continue;
    }
    const desired = desiredByOrigin.get(route.originSystemId);
    if (desired === undefined) {
      const origin = await ctx.db.get("gal_systems", route.originSystemId);
      const destination = await ctx.db.get("gal_systems", route.destinationSystemId);
      if (
        origin?.ownerEmpireId !== params.empireId ||
        destination?.ownerEmpireId !== params.empireId
      ) {
        continue;
      }
      await ctx.db.delete("flt_garrison_routes", route._id);
      continue;
    }
    if (
      !routeEndpointsOwnedByEmpire({
        route: desired,
        systemsById: params.systemsById,
        empireId: params.empireId,
      })
    ) {
      await ctx.db.delete("flt_garrison_routes", route._id);
      desiredByOrigin.delete(route.originSystemId);
      continue;
    }

    const hasManualOverride = params.existingRoutes.some(
      (candidate) =>
        candidate._id !== route._id &&
        candidate.originSystemId === route.originSystemId &&
        candidate.managedByStrategy !== true,
    );
    if (hasManualOverride) {
      await ctx.db.delete("flt_garrison_routes", route._id);
      desiredByOrigin.delete(route.originSystemId);
      continue;
    }

    const patch: {
      destinationSystemId?: Id<"gal_systems">;
      dispatchPct?: number;
      enabled?: boolean;
      ownershipInvalidTurns?: number;
      strategyPurpose?: StrategyPurpose;
      strategyUpdatedTurn?: number;
    } = {};
    if (route.destinationSystemId !== desired.destinationSystemId) {
      patch.destinationSystemId = desired.destinationSystemId;
    }
    if (route.dispatchPct !== desired.dispatchPct) {
      patch.dispatchPct = desired.dispatchPct;
    }
    if (!route.enabled) {
      patch.enabled = true;
    }
    if ((route.ownershipInvalidTurns ?? 0) !== 0) {
      patch.ownershipInvalidTurns = 0;
    }
    if (route.strategyPurpose !== desired.purpose) {
      patch.strategyPurpose = desired.purpose;
    }
    if (route.strategyUpdatedTurn !== params.turnNumber) {
      patch.strategyUpdatedTurn = params.turnNumber;
    }
    if (Object.keys(patch).length > 0) {
      await ctx.db.patch("flt_garrison_routes", route._id, patch);
    }
    desiredByOrigin.delete(route.originSystemId);
  }

  for (const route of desiredByOrigin.values()) {
    if (
      !routeEndpointsOwnedByEmpire({
        route,
        systemsById: params.systemsById,
        empireId: params.empireId,
      })
    ) {
      continue;
    }
    const hasManualOverride = hasManualRouteOverride(
      params.existingRoutes,
      route.originSystemId,
    );
    if (hasManualOverride) continue;

    await ctx.db.insert("flt_garrison_routes", {
      gameId: params.gameId,
      empireId: params.empireId,
      originSystemId: route.originSystemId,
      destinationSystemId: route.destinationSystemId,
      dispatchPct: route.dispatchPct,
      enabled: true,
      managedByStrategy: true,
      strategyPurpose: route.purpose,
      strategyUpdatedTurn: params.turnNumber,
    });
  }
}

async function dispatchStrategyConquestMoves(
  ctx: MutationCtx,
  params: {
    gameId: Id<"sim_games">;
    empireId: Id<"emp_states">;
    turnNumber: number;
    desiredRoutes: DesiredRoute[];
    existingRoutes: Doc<"flt_garrison_routes">[];
    systemsById: Map<Id<"gal_systems">, Doc<"gal_systems">>;
    manualOrderOriginKeys: Set<string>;
  },
): Promise<void> {
  for (const route of params.desiredRoutes) {
    if (route.dispatchPct <= 0) continue;
    if (
      hasManualOrderOriginLock(params.manualOrderOriginKeys, {
        empireId: params.empireId,
        originSystemId: route.originSystemId,
      })
    ) {
      continue;
    }
    if (hasManualRouteOverride(params.existingRoutes, route.originSystemId)) {
      continue;
    }

    const origin = params.systemsById.get(route.originSystemId);
    const destination = params.systemsById.get(route.destinationSystemId);
    if (
      origin === undefined ||
      destination === undefined ||
      origin.ownerEmpireId !== params.empireId ||
      destination.ownerEmpireId === params.empireId
    ) {
      continue;
    }

    const fleetsSnapshot = await idleFleetsAtSystemForEmpire(ctx, {
      gameId: params.gameId,
      empireId: params.empireId,
      originSystemId: route.originSystemId,
    });
    const totalIdle = fleetsSnapshot.reduce((sum, fleet) => sum + fleet.strength, 0);
    let remaining = shipsToDispatchFromPct(totalIdle, route.dispatchPct);
    if (remaining <= 0) continue;

    let chunkIndex = 0;
    while (remaining > 0) {
      const idleNow = await idleFleetsAtSystemForEmpire(ctx, {
        gameId: params.gameId,
        empireId: params.empireId,
        originSystemId: route.originSystemId,
      });
      if (idleNow.length === 0) break;

      idleNow.sort(
        (a, b) => b.strength - a.strength || a._id.localeCompare(b._id),
      );

      const fleet = idleNow[0];
      const chunk = Math.min(fleet.strength, remaining);
      const fresh = await ctx.db.get("flt_fleets", fleet._id);
      if (fresh === null || fresh.status !== "idle") break;

      const ok = await dispatchMoveFromFleet(ctx, {
        gameId: params.gameId,
        turnNumber: params.turnNumber,
        fleet: fresh,
        targetSystemId: route.destinationSystemId,
        shipsToMove: chunk,
        dispatchKeySuffix: `strategy-${route.purpose}-${params.turnNumber}-${chunkIndex}`,
        eventPayloadExtra: {
          viaStrategyConquest: true,
          strategyPurpose: route.purpose,
          dispatchPct: route.dispatchPct,
        },
      });
      if (!ok) break;

      remaining -= chunk;
      chunkIndex += 1;
    }
  }
}

async function maintainStrategyRoutesForEmpire(
  ctx: MutationCtx,
  params: {
    gameId: Id<"sim_games">;
    turnNumber: number;
    empire: Doc<"emp_states">;
    automation: StrategyAutomation;
    runtime: RuntimeStrategyAutomation;
    systems: Doc<"gal_systems">[];
    ownedSystems: Doc<"gal_systems">[];
    priorityRows: Doc<"emp_priority_stars">[];
    adjacency: Map<string, Id<"gal_systems">[]>;
    strengthBySystem: Map<string, Map<string, number>>;
    existingRoutes: Doc<"flt_garrison_routes">[];
    manualOrderOriginKeys: Set<string>;
  },
): Promise<void> {
  const systemsById = new Map(params.systems.map((system) => [system._id, system]));
  const ownedSystems = params.ownedSystems;
  const ownedSystemIds = new Set(ownedSystems.map((system) => system._id as string));
  if (ownedSystems.length === 0) {
    await upsertStrategyRoutes(ctx, {
      gameId: params.gameId,
      empireId: params.empire._id,
      turnNumber: params.turnNumber,
      desiredRoutes: [],
      existingRoutes: params.existingRoutes,
      systemsById,
    });
    return;
  }

  const borderSystems = ownedSystems.filter((system) =>
    (params.adjacency.get(system._id) ?? []).some((neighborId) => {
      const neighbor = systemsById.get(neighborId);
      return neighbor !== undefined && neighbor.ownerEmpireId !== params.empire._id;
    }),
  );
  const borderSystemIds = new Set(borderSystems.map((system) => system._id as string));
  const desired = new Map<string, DesiredRoute>();

  if (params.automation.reinforceAttackedSystems) {
    const threatenedSystemIds = new Set(
      ownedSystems
        .filter((system) => system.underAttack === true)
        .map((system) => system._id as string),
    );
    if (threatenedSystemIds.size > 0) {
      for (const origin of ownedSystems) {
        if (threatenedSystemIds.has(origin._id)) continue;
        const firstHop = firstHopTowardNearestTarget({
          originSystemId: origin._id,
          targetSystemIds: threatenedSystemIds,
          ownedSystemIds,
          adjacency: params.adjacency,
        });
        if (firstHop === null) continue;
        putDesiredRoute(desired, {
          originSystemId: origin._id,
          destinationSystemId: firstHop,
          dispatchPct: Math.round(100 - params.runtime.emergencyReserveShipsPct),
          purpose: "emergencyReinforce",
        });
      }
    }
  }

  if (params.runtime.priorityStarPolicy.enabled && params.priorityRows.length > 0) {
    const ownedFleetStrengths = ownedSystems.map((system) =>
      strengthAtSystemForEmpire(params.strengthBySystem, system._id, params.empire._id),
    );
    const averageFleetStrength =
      ownedFleetStrengths.reduce((sum, strength) => sum + strength, 0) /
      Math.max(1, ownedFleetStrengths.length);
    const requiredPriorityDefense =
      averageFleetStrength * params.runtime.priorityStarPolicy.minDefenseAverageFleetMult;
    const priorityRowsSorted = [...params.priorityRows].sort((a, b) =>
      a.systemId.localeCompare(b.systemId),
    );

    // Frontier approaches first so interior corridor merges do not obscure conquest intents.
    for (const priorityRow of priorityRowsSorted) {
      const prioritySystem = systemsById.get(priorityRow.systemId);
      if (prioritySystem === undefined) continue;
      if (prioritySystem.ownerEmpireId === params.empire._id) continue;

      const approach = findApproachToPriorityStarWithinTwoJumps({
        prioritySystemId: prioritySystem._id,
        ownedSystems,
        adjacency: params.adjacency,
      });
      if (approach === null) continue;
      putDesiredRoute(desired, {
        originSystemId: approach.originSystemId,
        destinationSystemId: approach.nextHopSystemId,
        dispatchPct: Math.round(params.runtime.priorityStarPolicy.approachDispatchPct),
        purpose: "priorityApproach",
      });
    }

    if (params.runtime.priorityStarPolicy.ownedCorridorStandingOrdersEnabled) {
      /** Marked Priority systems this empire controls (anchors for logistical standing orders). */
      const ownedPriorityTargetIds = new Set<string>();
      for (const row of priorityRowsSorted) {
        const sys = systemsById.get(row.systemId);
        if (sys !== undefined && sys.ownerEmpireId === params.empire._id) {
          ownedPriorityTargetIds.add(sys._id as string);
        }
      }
      if (ownedPriorityTargetIds.size > 0) {
        const ownedSorted = [...ownedSystems].sort((a, b) => a._id.localeCompare(b._id));
        for (const origin of ownedSorted) {
          if (ownedPriorityTargetIds.has(origin._id as string)) continue;
          const firstHop = firstHopTowardNearestTarget({
            originSystemId: origin._id,
            targetSystemIds: ownedPriorityTargetIds,
            ownedSystemIds,
            adjacency: params.adjacency,
          });
          if (firstHop === null) continue;
          putDesiredRoute(desired, {
            originSystemId: origin._id,
            destinationSystemId: firstHop,
            dispatchPct: Math.round(params.runtime.priorityStarPolicy.ownedCorridorDispatchPct),
            purpose: "priorityOwnedCorridor",
          });
        }
      }
    }

    for (const priorityRow of priorityRowsSorted) {
      const prioritySystem = systemsById.get(priorityRow.systemId);
      if (prioritySystem === undefined) continue;
      if (prioritySystem.ownerEmpireId !== params.empire._id) continue;

      const neighbors = (params.adjacency.get(prioritySystem._id) ?? [])
        .map((neighborId) => systemsById.get(neighborId))
        .filter((system): system is Doc<"gal_systems"> => system !== undefined)
        .sort((a, b) => a._id.localeCompare(b._id));

      const enemyNeighbors = neighbors.filter(
        (system) =>
          system.ownerEmpireId !== null && system.ownerEmpireId !== params.empire._id,
      );
      if (enemyNeighbors.length > 0) {
        const priorityStrength = strengthAtSystemForEmpire(
          params.strengthBySystem,
          prioritySystem._id,
          params.empire._id,
        );
        if (priorityStrength < requiredPriorityDefense) {
          for (const origin of ownedSystems) {
            if (origin._id === prioritySystem._id) continue;
            const firstHop = firstHopTowardNearestTarget({
              originSystemId: origin._id,
              targetSystemIds: new Set([prioritySystem._id]),
              ownedSystemIds,
              adjacency: params.adjacency,
            });
            if (firstHop === null) continue;
            putDesiredRoute(desired, {
              originSystemId: origin._id,
              destinationSystemId: firstHop,
              dispatchPct: Math.round(params.runtime.priorityStarPolicy.stagingDispatchPct),
              purpose: "priorityEnemyStaging",
            });
          }
          continue;
        }

        const target = enemyNeighbors[0];
        const enemyStrength = Math.max(
          1,
          totalForeignStrengthAtSystem(params.strengthBySystem, target._id, params.empire._id),
        );
        const attackAdvantage =
          params.runtime.priorityStarPolicy.enemyAttackAdvantageRequired ??
          params.runtime.attackAdvantageRequired;
        const canAttack = priorityStrength >= enemyStrength * attackAdvantage;
        const defenseReservePct =
          priorityStrength > 0
            ? Math.ceil((requiredPriorityDefense / priorityStrength) * 100)
            : 100;
        const dispatchPct = Math.min(
          params.runtime.priorityStarPolicy.enemyDispatchPct,
          Math.max(0, 100 - defenseReservePct),
        );
        if (canAttack && dispatchPct > 0) {
          putDesiredRoute(desired, {
            originSystemId: prioritySystem._id,
            destinationSystemId: target._id,
            dispatchPct: Math.round(dispatchPct),
            purpose: "priorityEnemyAttack",
          });
        }
        continue;
      }

      const neutralNeighbors = neighbors.filter((system) => system.ownerEmpireId === null);
      if (neutralNeighbors.length > 0) {
        const target = [...neutralNeighbors].sort(
          (a, b) => systemResourceScore(b) - systemResourceScore(a) || a._id.localeCompare(b._id),
        )[0];
        putDesiredRoute(desired, {
          originSystemId: prioritySystem._id,
          destinationSystemId: target._id,
          dispatchPct: Math.round(params.runtime.priorityStarPolicy.neutralDispatchPct),
          purpose: "priorityNeutralTarget",
        });
      }
    }
  }

  for (const origin of borderSystems) {
    const neighbors = params.adjacency.get(origin._id) ?? [];
    const neutralNeighbors = neighbors
      .map((neighborId) => systemsById.get(neighborId))
      .filter((system): system is Doc<"gal_systems"> => system?.ownerEmpireId === null);

    if (params.automation.earlyRush && neutralNeighbors.length > 0) {
      const sortedNeutral = [...neutralNeighbors].sort((a, b) => {
        if (params.automation.neutralWorldPriority === "richest") {
          return systemResourceScore(b) - systemResourceScore(a) || a._id.localeCompare(b._id);
        }
        return a._id.localeCompare(b._id);
      });
      putDesiredRoute(desired, {
        originSystemId: origin._id,
        destinationSystemId: sortedNeutral[0]._id,
        dispatchPct: Math.round(100 - params.runtime.reserveShipsPct),
        purpose: "earlyRush",
      });
      continue;
    }

    if (
      params.automation.stance !== "passive" &&
      params.automation.stance !== "defensive"
    ) {
      const enemyNeighbors = neighbors
        .map((neighborId) => systemsById.get(neighborId))
        .filter(
          (system): system is Doc<"gal_systems"> =>
            system !== undefined &&
            system.ownerEmpireId !== null &&
            system.ownerEmpireId !== params.empire._id,
        )
        .sort((a, b) => a._id.localeCompare(b._id));

      for (const target of enemyNeighbors) {
        const availableAttack = strengthAtSystemForEmpire(
          params.strengthBySystem,
          origin._id,
          params.empire._id,
        );
        const enemyStrength = Math.max(
          1,
          totalForeignStrengthAtSystem(params.strengthBySystem, target._id, params.empire._id),
        );
        if (
          availableAttack >=
          enemyStrength * params.runtime.attackAdvantageRequired
        ) {
          putDesiredRoute(desired, {
            originSystemId: origin._id,
            destinationSystemId: target._id,
            dispatchPct: Math.round(100 - params.runtime.enemyAttackBorderReservePct),
            purpose: "enemyAttack",
          });
          break;
        }
      }
    }
  }

  if (params.automation.moveDeepFleetsToBorder && borderSystems.length > 0) {
    for (const origin of ownedSystems) {
      if (borderSystemIds.has(origin._id)) continue;
      const firstHop = firstHopTowardNearestBorder({
        originSystemId: origin._id,
        borderSystemIds,
        ownedSystemIds,
        adjacency: params.adjacency,
      });
      if (firstHop === null) continue;
      putDesiredRoute(desired, {
        originSystemId: origin._id,
        destinationSystemId: firstHop,
        dispatchPct: Math.round(100 - params.runtime.reinforceBorderReservePct),
        purpose: "borderReinforce",
      });
    }
  }

  const desiredRoutes = Array.from(desired.values()).filter((route) => route.dispatchPct > 0);

  await dispatchStrategyConquestMoves(ctx, {
    gameId: params.gameId,
    empireId: params.empire._id,
    turnNumber: params.turnNumber,
    desiredRoutes,
    existingRoutes: params.existingRoutes,
    systemsById,
    manualOrderOriginKeys: params.manualOrderOriginKeys,
  });

  await upsertStrategyRoutes(ctx, {
    gameId: params.gameId,
    empireId: params.empire._id,
    turnNumber: params.turnNumber,
    desiredRoutes,
    existingRoutes: params.existingRoutes,
    systemsById,
  });
}

export async function applyNpcStrategy(
  ctx: MutationCtx,
  params: {
    gameId: Id<"sim_games">;
    turnNumber: number;
  },
): Promise<void> {
  const empires = await ctx.db
    .query("emp_states")
    .withIndex("by_gameId", (q) => q.eq("gameId", params.gameId))
    .take(64);
  const systems = await ctx.db
    .query("gal_systems")
    .withIndex("by_gameId", (q) => q.eq("gameId", params.gameId))
    .take(512);
  const links = await ctx.db
    .query("gal_links")
    .withIndex("by_gameId", (q) => q.eq("gameId", params.gameId))
    .take(1024);
  const fleets = await ctx.db
    .query("flt_fleets")
    .withIndex("by_gameId", (q) => q.eq("gameId", params.gameId))
    .take(512);
  const routes = await ctx.db
    .query("flt_garrison_routes")
    .withIndex("by_gameId", (q) => q.eq("gameId", params.gameId))
    .take(512);
  const priorityRows = await ctx.db
    .query("emp_priority_stars")
    .withIndex("by_gameId", (q) => q.eq("gameId", params.gameId))
    .take(512);
  const manualOrderOriginKeys = await loadManualOrderOriginLocks(ctx, params);

  const adjacency = buildAdjacency(links);
  const strengthBySystem = fleetStrengthBySystem(fleets);
  const systemsById = new Map(systems.map((system) => [system._id, system]));
  const systemsByEmpire = new Map<string, Doc<"gal_systems">[]>();
  for (const system of systems) {
    if (system.ownerEmpireId === null) continue;
    const existing = systemsByEmpire.get(system.ownerEmpireId) ?? [];
    existing.push(system);
    systemsByEmpire.set(system.ownerEmpireId, existing);
  }
  const routesByEmpire = new Map<string, Doc<"flt_garrison_routes">[]>();
  for (const route of routes) {
    const existing = routesByEmpire.get(route.empireId) ?? [];
    existing.push(route);
    routesByEmpire.set(route.empireId, existing);
  }
  const priorityRowsByEmpire = new Map<string, Doc<"emp_priority_stars">[]>();
  for (const priorityRow of priorityRows) {
    const existing = priorityRowsByEmpire.get(priorityRow.empireId) ?? [];
    existing.push(priorityRow);
    priorityRowsByEmpire.set(priorityRow.empireId, existing);
  }

  for (const empire of empires) {
    let existingRoutes = routesByEmpire.get(empire._id) ?? [];
    if (empire.standingOrdersRefreshRequestedAt !== undefined) {
      for (const route of existingRoutes) {
        await ctx.db.delete("flt_garrison_routes", route._id);
      }
      await ctx.db.patch("emp_states", empire._id, {
        standingOrdersRefreshRequestedAt: undefined,
      });
      existingRoutes = [];
    }

    if (empire.isCollapsed || empire.strategyJson === undefined) {
      continue;
    }

    const ownedSystems = systemsByEmpire.get(empire._id) ?? [];
    const automation = parseAutomation(empire.strategyJson);
    const empirePriorityRows = priorityRowsByEmpire.get(empire._id) ?? [];
    const priorityStarObjectiveActive =
      automation !== null &&
      automation.priorityStarPolicy.enabled &&
      hasPriorityStarObjective({
        priorityRows: empirePriorityRows,
        systemsById,
        ownedSystems,
        empireId: empire._id,
        adjacency,
      });
    const economy = parseEconomy(empire.strategyJson);
    const runtimeAutomation =
      automation !== null
        ? buildRuntimeStrategyAutomation({
            automation,
            sliders: resolveStrategicSliders(
              computeStrategicSliderDefaults(automation),
              empire.strategicSliderOverrides,
            ),
          })
        : null;
    if (economy !== null) {
      await applyEconomyStrategyToEmpire(ctx, {
        gameId: params.gameId,
        turnNumber: params.turnNumber,
        empire,
        economy,
        ownedSystems,
        priorityStarPolicy:
          runtimeAutomation?.priorityStarPolicy ?? automation?.priorityStarPolicy,
        priorityStarObjectiveActive,
      });
    }

    if (automation !== null && runtimeAutomation !== null) {
      await maintainStrategyRoutesForEmpire(ctx, {
        gameId: params.gameId,
        turnNumber: params.turnNumber,
        empire,
        automation,
        runtime: runtimeAutomation,
        systems,
        ownedSystems,
        priorityRows: empirePriorityRows,
        adjacency,
        strengthBySystem,
        existingRoutes,
        manualOrderOriginKeys,
      });
    }
  }
}

export const applyNpcStrategyAndGarrisonRoutes = internalMutation({
  args: {
    gameId: v.id("sim_games"),
    turnNumber: v.number(),
  },
  handler: async (ctx, args) => {
    await applyNpcStrategy(ctx, args);
    await applyGarrisonRoutes(ctx, args);
    await cleanupFleetOrdersForTurn(ctx, args);
    return null;
  },
});
