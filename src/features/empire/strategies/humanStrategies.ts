import type { EmpireStrategy } from "./npcStrategies";

/**
 * Human-focused autopilot that keeps the user's tuned baseline intact while
 * enabling the newer Priority star automation hooks.
 *
 * Recommended use: mark fewer than ~20% of stars as Priority stars so the
 * script has a clear strategic signal for staging, expansion, and attacks.
 */
export const IMPROVED_HUMAN_AUTOPILOT_PRIORITY_STRATEGY: EmpireStrategy = {
  archetype: "Improved Human Autopilot - Priority Stars",
  description:
    "Expansion-forward human autopilot with high ship output, aggressive food-shortage recovery, attacked-system reinforcement, and Priority star objectives for strategic staging and expansion.",
  economy: {
    taxRateTarget: 0.2,
    emphasisFood: 30,
    emphasisShips: 70,
    emphasisResearch: 0,
    foodSubsidyEnabled: false,
    foodSubsidyPerUnit: 0,
    foodShortageResponse: {
      enabled: true,
      shiftPctPerTurn: 25,
      minShipsPct: 0,
      maxFoodPct: 100,
      recoveryTurns: 15,
    },
  },
  military: {
    aggressionLevel: "balanced",
  },
  expansion: {
    colonizationEnabled: true,
    colonizationThreshold: 650,
    earlyRush: true,
    neutralWorldPriority: "richest",
    reserveShipsPct: 14,
  },
  fleetPosture: {
    moveDeepFleetsToBorder: true,
    borderReserveShipsPct: 12,
    reinforceAttackedSystems: true,
    emergencyReserveShipsPct: 6,
  },
  priorityStarPolicy: {
    enabled: true,
    neutralDispatchPct: 100,
    stagingDispatchPct: 92,
    enemyDispatchPct: 55,
    approachDispatchPct: 100,
    enemyAttackAdvantageRequired: 4,
    minDefenseAverageFleetMult: 1.15,
    shipProductionBoostPct: 22,
    minFoodStockpileTurns: 4,
    ownedCorridorStandingOrdersEnabled: true,
    ownedCorridorDispatchPct: 88,
  },
  borderPolicy: {
    stance: "aggressive",
    attackAdvantageRequired: 10,
  },
};

export const HUMAN_EMPIRE_STRATEGIES: Record<string, EmpireStrategy> = {
  "improved-human-autopilot-priority": IMPROVED_HUMAN_AUTOPILOT_PRIORITY_STRATEGY,
};

export function formatHumanStrategyJson(strategy: EmpireStrategy): string {
  return JSON.stringify(strategy, null, 2);
}
