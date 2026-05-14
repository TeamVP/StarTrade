export type EmpireStrategy = {
  archetype: string;
  description: string;
  economy: {
    taxRateTarget: number;
    emphasisFood: number;
    emphasisShips: number;
    emphasisResearch: number;
    foodSubsidyEnabled: boolean;
    foodSubsidyPerUnit: number;
    foodShortageResponse?: {
      enabled: boolean;
      shiftPctPerTurn: number;
      minShipsPct: number;
      maxFoodPct: number;
      recoveryTurns: number;
    };
  };
  military: {
    aggressionLevel: "passive" | "defensive" | "balanced" | "aggressive" | "warlike";
  };
  expansion: {
    colonizationEnabled: boolean;
    colonizationThreshold: number;
    earlyRush: boolean;
    neutralWorldPriority: "nearest" | "richest" | "weakestDefended";
    reserveShipsPct: number;
  };
  fleetPosture: {
    moveDeepFleetsToBorder: boolean;
    borderReserveShipsPct: number;
    reinforceAttackedSystems?: boolean;
    emergencyReserveShipsPct?: number;
  };
  priorityStarPolicy?: {
    enabled: boolean;
    neutralDispatchPct: number;
    stagingDispatchPct: number;
    enemyDispatchPct: number;
    approachDispatchPct: number;
    enemyAttackAdvantageRequired?: number;
    minDefenseAverageFleetMult: number;
    shipProductionBoostPct: number;
    minFoodStockpileTurns: number;
    /** Standing orders on every owned star along the shortest owned path to the nearest owned Priority star. */
    ownedCorridorStandingOrdersEnabled?: boolean;
    ownedCorridorDispatchPct?: number;
  };
  borderPolicy: {
    stance: "passive" | "defensive" | "balanced" | "aggressive" | "warlike";
    attackAdvantageRequired: number;
  };
};

export const PRIORITY_STAR_MAX_STRATEGY: EmpireStrategy = {
  archetype: "Priority Star Vanguard",
  description:
    "A showcase automation brain: marked Priority stars become the empire's top strategic objectives, driving expansion, staging, defense, attacks, emergency reinforcement, and short-term ship mobilization.",
  economy: {
    taxRateTarget: 0.18,
    emphasisFood: 32,
    emphasisShips: 48,
    emphasisResearch: 20,
    foodSubsidyEnabled: true,
    foodSubsidyPerUnit: 6,
    foodShortageResponse: {
      enabled: true,
      shiftPctPerTurn: 15,
      minShipsPct: 15,
      maxFoodPct: 80,
      recoveryTurns: 2,
    },
  },
  military: { aggressionLevel: "warlike" },
  expansion: {
    colonizationEnabled: true,
    colonizationThreshold: 450,
    earlyRush: true,
    neutralWorldPriority: "richest",
    reserveShipsPct: 12,
  },
  fleetPosture: {
    moveDeepFleetsToBorder: true,
    borderReserveShipsPct: 18,
    reinforceAttackedSystems: true,
    emergencyReserveShipsPct: 8,
  },
  priorityStarPolicy: {
    enabled: true,
    neutralDispatchPct: 95,
    stagingDispatchPct: 92,
    enemyDispatchPct: 90,
    approachDispatchPct: 95,
    enemyAttackAdvantageRequired: 0.9,
    minDefenseAverageFleetMult: 1.25,
    shipProductionBoostPct: 18,
    minFoodStockpileTurns: 3,
    ownedCorridorStandingOrdersEnabled: true,
    ownedCorridorDispatchPct: 90,
  },
  borderPolicy: { stance: "warlike", attackAdvantageRequired: 1.1 },
};

export const NPC_EMPIRE_STRATEGIES: Record<string, EmpireStrategy> = {
  "priority-star-vanguard": PRIORITY_STAR_MAX_STRATEGY,
  "maia-solenne": {
    archetype: "Diplomatic Mercantile",
    description:
      "Keeps taxes low, grows food reserves, and pays reliable import subsidies to stay trade-friendly.",
    economy: {
      taxRateTarget: 0.08,
      emphasisFood: 55,
      emphasisShips: 20,
      emphasisResearch: 25,
      foodSubsidyEnabled: true,
      foodSubsidyPerUnit: 8,
    },
    military: { aggressionLevel: "defensive" },
    expansion: {
      colonizationEnabled: true,
      colonizationThreshold: 500,
      earlyRush: true,
      neutralWorldPriority: "nearest",
      reserveShipsPct: 35,
    },
    fleetPosture: { moveDeepFleetsToBorder: true, borderReserveShipsPct: 55 },
    borderPolicy: { stance: "defensive", attackAdvantageRequired: 999 },
  },
  "tomas-varek": {
    archetype: "Industrial Militarist",
    description:
      "Turns production into hulls quickly, accepting higher taxes and a lower research tempo.",
    economy: {
      taxRateTarget: 0.2,
      emphasisFood: 25,
      emphasisShips: 55,
      emphasisResearch: 20,
      foodSubsidyEnabled: false,
      foodSubsidyPerUnit: 0,
    },
    military: { aggressionLevel: "aggressive" },
    expansion: {
      colonizationEnabled: true,
      colonizationThreshold: 700,
      earlyRush: true,
      neutralWorldPriority: "richest",
      reserveShipsPct: 20,
    },
    fleetPosture: { moveDeepFleetsToBorder: true, borderReserveShipsPct: 25 },
    borderPolicy: { stance: "aggressive", attackAdvantageRequired: 1 },
  },
  "nari-quell": {
    archetype: "Settler Collective",
    description:
      "Prioritizes surplus food and low taxes so new holdings can grow before hardening defenses.",
    economy: {
      taxRateTarget: 0.06,
      emphasisFood: 65,
      emphasisShips: 20,
      emphasisResearch: 15,
      foodSubsidyEnabled: true,
      foodSubsidyPerUnit: 5,
    },
    military: { aggressionLevel: "passive" },
    expansion: {
      colonizationEnabled: true,
      colonizationThreshold: 350,
      earlyRush: true,
      neutralWorldPriority: "nearest",
      reserveShipsPct: 45,
    },
    fleetPosture: { moveDeepFleetsToBorder: true, borderReserveShipsPct: 60 },
    borderPolicy: { stance: "passive", attackAdvantageRequired: 999 },
  },
  "orin-kade": {
    archetype: "Balanced Strategist",
    description:
      "Maintains an even economy and avoids committing to wars without a clear material edge.",
    economy: {
      taxRateTarget: 0.14,
      emphasisFood: 34,
      emphasisShips: 33,
      emphasisResearch: 33,
      foodSubsidyEnabled: true,
      foodSubsidyPerUnit: 3,
    },
    military: { aggressionLevel: "balanced" },
    expansion: {
      colonizationEnabled: true,
      colonizationThreshold: 600,
      earlyRush: true,
      neutralWorldPriority: "nearest",
      reserveShipsPct: 30,
    },
    fleetPosture: { moveDeepFleetsToBorder: true, borderReserveShipsPct: 40 },
    borderPolicy: { stance: "balanced", attackAdvantageRequired: 4 },
  },
  "selene-crow": {
    archetype: "Shadow Council",
    description:
      "Builds a research edge while keeping enough ships in reserve for opportunistic pressure.",
    economy: {
      taxRateTarget: 0.16,
      emphasisFood: 25,
      emphasisShips: 30,
      emphasisResearch: 45,
      foodSubsidyEnabled: false,
      foodSubsidyPerUnit: 0,
    },
    military: { aggressionLevel: "balanced" },
    expansion: {
      colonizationEnabled: true,
      colonizationThreshold: 800,
      earlyRush: true,
      neutralWorldPriority: "weakestDefended",
      reserveShipsPct: 35,
    },
    fleetPosture: { moveDeepFleetsToBorder: true, borderReserveShipsPct: 45 },
    borderPolicy: { stance: "balanced", attackAdvantageRequired: 4 },
  },
  "bastian-roe": {
    archetype: "Trade Magnate",
    description:
      "Uses imports and a soft military posture to turn cash flow into steady civilian growth.",
    economy: {
      taxRateTarget: 0.1,
      emphasisFood: 45,
      emphasisShips: 15,
      emphasisResearch: 40,
      foodSubsidyEnabled: true,
      foodSubsidyPerUnit: 12,
    },
    military: { aggressionLevel: "defensive" },
    expansion: {
      colonizationEnabled: false,
      colonizationThreshold: 900,
      earlyRush: false,
      neutralWorldPriority: "richest",
      reserveShipsPct: 50,
    },
    fleetPosture: { moveDeepFleetsToBorder: true, borderReserveShipsPct: 65 },
    borderPolicy: { stance: "defensive", attackAdvantageRequired: 999 },
  },
  "lyra-stone": {
    archetype: "Ruthless Expansionist",
    description:
      "Extracts hard, builds hard, and pushes aggressively when nearby worlds look vulnerable.",
    economy: {
      taxRateTarget: 0.28,
      emphasisFood: 20,
      emphasisShips: 60,
      emphasisResearch: 20,
      foodSubsidyEnabled: false,
      foodSubsidyPerUnit: 0,
    },
    military: { aggressionLevel: "warlike" },
    expansion: {
      colonizationEnabled: true,
      colonizationThreshold: 450,
      earlyRush: true,
      neutralWorldPriority: "weakestDefended",
      reserveShipsPct: 10,
    },
    fleetPosture: { moveDeepFleetsToBorder: true, borderReserveShipsPct: 15 },
    borderPolicy: { stance: "warlike", attackAdvantageRequired: 0.8 },
  },
  "ivon-marsk": {
    archetype: "Fortified Directorate",
    description:
      "Raises taxes for a disciplined state budget and favors defensive fleet buildup.",
    economy: {
      taxRateTarget: 0.22,
      emphasisFood: 30,
      emphasisShips: 40,
      emphasisResearch: 30,
      foodSubsidyEnabled: true,
      foodSubsidyPerUnit: 2,
    },
    military: { aggressionLevel: "defensive" },
    expansion: {
      colonizationEnabled: false,
      colonizationThreshold: 1_000,
      earlyRush: false,
      neutralWorldPriority: "nearest",
      reserveShipsPct: 55,
    },
    fleetPosture: { moveDeepFleetsToBorder: true, borderReserveShipsPct: 70 },
    borderPolicy: { stance: "defensive", attackAdvantageRequired: 999 },
  },
  "calla-ren": {
    archetype: "Research Ascendancy",
    description:
      "Accepts a smaller fleet in exchange for compounding research gains and stable food reserves.",
    economy: {
      taxRateTarget: 0.12,
      emphasisFood: 25,
      emphasisShips: 15,
      emphasisResearch: 60,
      foodSubsidyEnabled: true,
      foodSubsidyPerUnit: 4,
    },
    military: { aggressionLevel: "passive" },
    expansion: {
      colonizationEnabled: true,
      colonizationThreshold: 750,
      earlyRush: true,
      neutralWorldPriority: "richest",
      reserveShipsPct: 45,
    },
    fleetPosture: { moveDeepFleetsToBorder: true, borderReserveShipsPct: 60 },
    borderPolicy: { stance: "passive", attackAdvantageRequired: 999 },
  },
  "dax-helion": {
    archetype: "Corsair Raiders",
    description:
      "Keeps fleets supplied for constant pressure, with minimal concern for research depth.",
    economy: {
      taxRateTarget: 0.24,
      emphasisFood: 20,
      emphasisShips: 65,
      emphasisResearch: 15,
      foodSubsidyEnabled: false,
      foodSubsidyPerUnit: 0,
    },
    military: { aggressionLevel: "aggressive" },
    expansion: {
      colonizationEnabled: true,
      colonizationThreshold: 500,
      earlyRush: true,
      neutralWorldPriority: "weakestDefended",
      reserveShipsPct: 15,
    },
    fleetPosture: { moveDeepFleetsToBorder: true, borderReserveShipsPct: 20 },
    borderPolicy: { stance: "aggressive", attackAdvantageRequired: 1 },
  },
};

export function formatStrategyJson(strategy: EmpireStrategy): string {
  return JSON.stringify(strategy, null, 2);
}
