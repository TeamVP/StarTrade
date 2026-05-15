import { parseAutomation } from "../sim/economy/applyNpcStrategy";

type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
type JsonObject = { [key: string]: JsonValue };

export type PublicAutomationStrategy = {
  key: string;
  name: string;
  description: string;
  tags: string[];
  strategyJson: string;
  preview: {
    stance: string;
    earlyRush: boolean;
    reserveShipsPct: number;
    reinforceAttackedSystems: boolean;
  } | null;
};

const ALLOWED_TOP_LEVEL_STRATEGY_KEYS = new Set([
  "archetype",
  "description",
  "economy",
  "military",
  "expansion",
  "fleetPosture",
  "priorityStarPolicy",
  "priorityStars",
  "borderPolicy",
  "defense",
]);

function normalizeLegacyStrategyShape(strategy: JsonObject): JsonObject {
  const legacyFoodShortageResponse = strategy.foodShortageResponse;
  if (legacyFoodShortageResponse === undefined) {
    return strategy;
  }

  const normalized: JsonObject = { ...strategy };
  delete normalized.foodShortageResponse;

  const economyValue = normalized.economy;
  const economy: JsonObject =
    typeof economyValue === "object" &&
    economyValue !== null &&
    !Array.isArray(economyValue)
      ? { ...(economyValue as JsonObject) }
      : {};

  if (economy.foodShortageResponse === undefined) {
    economy.foodShortageResponse = cloneJsonValue(legacyFoodShortageResponse);
  }

  normalized.economy = economy;
  return normalized;
}

function asJsonObject(value: unknown, label: string): JsonObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be a JSON object.`);
  }
  return value as JsonObject;
}

function parseJsonObjectString(text: string, label: string): JsonObject {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    throw new Error(`${label} cannot be empty.`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new Error(`${label} must be valid JSON.`);
  }

  return asJsonObject(parsed, label);
}

export function canonicalizeStrategyJson(strategyJson: string): string {
  const strategy = normalizeLegacyStrategyShape(
    parseJsonObjectString(strategyJson, "Strategy JSON"),
  );
  for (const key of Object.keys(strategy)) {
    if (!ALLOWED_TOP_LEVEL_STRATEGY_KEYS.has(key)) {
      throw new Error(`Unsupported strategy key: ${key}`);
    }
  }
  return JSON.stringify(strategy, null, 2);
}

export function canonicalizeOverridesJson(overridesJson: string | null): string | null {
  if (overridesJson === null) {
    return null;
  }
  const overrides = normalizeLegacyStrategyShape(
    parseJsonObjectString(overridesJson, "Overrides JSON"),
  );
  for (const key of Object.keys(overrides)) {
    if (!ALLOWED_TOP_LEVEL_STRATEGY_KEYS.has(key)) {
      throw new Error(`Unsupported override key: ${key}`);
    }
  }
  return JSON.stringify(overrides, null, 2);
}

function cloneJsonValue(value: JsonValue): JsonValue {
  if (Array.isArray(value)) {
    return value.map(cloneJsonValue);
  }
  if (typeof value === "object" && value !== null) {
    const result: JsonObject = {};
    for (const [key, child] of Object.entries(value)) {
      result[key] = cloneJsonValue(child);
    }
    return result;
  }
  return value;
}

function mergeJsonValues(base: JsonValue | undefined, override: JsonValue): JsonValue {
  if (
    typeof base === "object" &&
    base !== null &&
    !Array.isArray(base) &&
    typeof override === "object" &&
    override !== null &&
    !Array.isArray(override)
  ) {
    const merged: JsonObject = { ...(base as JsonObject) };
    for (const [key, value] of Object.entries(override)) {
      merged[key] = mergeJsonValues(merged[key], value);
    }
    return merged;
  }
  return cloneJsonValue(override);
}

export function buildStrategyFromBaseAndOverrides(params: {
  baseStrategyJson: string;
  overridesJson: string | null;
}): { strategyJson: string; normalizedOverridesJson: string | null } {
  const base = parseJsonObjectString(params.baseStrategyJson, "Base strategy JSON");
  const normalizedOverridesJson = canonicalizeOverridesJson(params.overridesJson);
  if (normalizedOverridesJson === null) {
    return { strategyJson: JSON.stringify(base, null, 2), normalizedOverridesJson: null };
  }

  const overrides = parseJsonObjectString(normalizedOverridesJson, "Overrides JSON");
  const merged = mergeJsonValues(base, overrides);
  return {
    strategyJson: JSON.stringify(asJsonObject(merged, "Merged strategy JSON"), null, 2),
    normalizedOverridesJson,
  };
}

function previewFromStrategyJson(strategyJson: string): PublicAutomationStrategy["preview"] {
  const automation = parseAutomation(strategyJson);
  if (automation === null) {
    return null;
  }
  return {
    stance: automation.stance,
    earlyRush: automation.earlyRush,
    reserveShipsPct: automation.reserveShipsPct,
    reinforceAttackedSystems: automation.reinforceAttackedSystems,
  };
}

const PUBLIC_AUTOMATION_STRATEGY_SOURCE: Array<{
  key: string;
  name: string;
  description: string;
  tags: string[];
  strategy: JsonObject;
}> = [
  {
    key: "balanced-expedition",
    name: "Balanced Expedition",
    description:
      "Early neutral expansion with moderate reserves and a balanced border posture.",
    tags: ["balanced", "expansion", "starter"],
    strategy: {
      expansion: {
        earlyRush: true,
        neutralWorldPriority: "nearest",
        reserveShipsPct: 28,
      },
      fleetPosture: {
        reinforceAttackedSystems: true,
        emergencyReserveShipsPct: 24,
        moveDeepFleetsToBorder: true,
        borderReserveShipsPct: 38,
      },
      borderPolicy: {
        stance: "balanced",
        attackAdvantageRequired: 3.5,
      },
      priorityStarPolicy: {
        enabled: true,
        neutralDispatchPct: 82,
        stagingDispatchPct: 76,
        enemyDispatchPct: 74,
        approachDispatchPct: 82,
        minDefenseAverageFleetMult: 1.1,
        shipBoostPct: 18,
        minFoodStockpileTurns: 2,
        ownedCorridorStandingOrdersEnabled: true,
      },
      economy: {
        taxRateTarget: 0.05,
        emphasisFood: 34,
        emphasisShips: 33,
        emphasisResearch: 33,
        foodShortageResponse: {
          enabled: true,
          shiftPctPerTurn: 15,
          minShipsPct: 18,
          maxFoodPct: 65,
          recoveryTurns: 2,
        },
      },
    },
  },
  {
    key: "fortress-ledger",
    name: "Fortress Ledger",
    description:
      "A defensive economic profile that keeps deeper reserves and punishes bad fights.",
    tags: ["defense", "economy", "turtle"],
    strategy: {
      expansion: {
        earlyRush: false,
        neutralWorldPriority: "richest",
        reserveShipsPct: 44,
      },
      fleetPosture: {
        reinforceAttackedSystems: true,
        emergencyReserveShipsPct: 38,
        moveDeepFleetsToBorder: true,
        borderReserveShipsPct: 54,
      },
      borderPolicy: {
        stance: "defensive",
        attackAdvantageRequired: 8,
      },
      priorityStarPolicy: {
        enabled: true,
        neutralDispatchPct: 70,
        stagingDispatchPct: 68,
        enemyDispatchPct: 62,
        approachDispatchPct: 72,
        minDefenseAverageFleetMult: 1.35,
        shipBoostPct: 10,
        minFoodStockpileTurns: 3,
        ownedCorridorStandingOrdersEnabled: true,
      },
      economy: {
        taxRateTarget: 0.07,
        emphasisFood: 36,
        emphasisShips: 28,
        emphasisResearch: 36,
        foodShortageResponse: {
          enabled: true,
          shiftPctPerTurn: 18,
          minShipsPct: 20,
          maxFoodPct: 70,
          recoveryTurns: 3,
        },
      },
    },
  },
  {
    key: "shock-lance",
    name: "Shock Lance",
    description:
      "Fast early pressure with low reserves and a warlike attack threshold.",
    tags: ["aggressive", "rush", "military"],
    strategy: {
      expansion: {
        earlyRush: true,
        neutralWorldPriority: "weakestDefended",
        reserveShipsPct: 18,
      },
      fleetPosture: {
        reinforceAttackedSystems: true,
        emergencyReserveShipsPct: 14,
        moveDeepFleetsToBorder: true,
        borderReserveShipsPct: 22,
      },
      borderPolicy: {
        stance: "warlike",
        attackAdvantageRequired: 0.9,
      },
      priorityStarPolicy: {
        enabled: true,
        neutralDispatchPct: 90,
        stagingDispatchPct: 88,
        enemyDispatchPct: 86,
        approachDispatchPct: 90,
        minDefenseAverageFleetMult: 0.9,
        shipBoostPct: 28,
        minFoodStockpileTurns: 1,
        ownedCorridorStandingOrdersEnabled: true,
      },
      economy: {
        taxRateTarget: 0.04,
        emphasisFood: 30,
        emphasisShips: 44,
        emphasisResearch: 26,
        foodShortageResponse: {
          enabled: true,
          shiftPctPerTurn: 10,
          minShipsPct: 28,
          maxFoodPct: 56,
          recoveryTurns: 1,
        },
      },
    },
  },
];

export const PUBLIC_AUTOMATION_STRATEGIES: PublicAutomationStrategy[] =
  PUBLIC_AUTOMATION_STRATEGY_SOURCE.map((entry) => {
    const strategyJson = JSON.stringify(entry.strategy, null, 2);
    return {
      key: entry.key,
      name: entry.name,
      description: entry.description,
      tags: entry.tags,
      strategyJson,
      preview: previewFromStrategyJson(strategyJson),
    };
  });

const PUBLIC_AUTOMATION_STRATEGY_BY_KEY = new Map(
  PUBLIC_AUTOMATION_STRATEGIES.map((strategy) => [strategy.key, strategy]),
);

export function getPublicAutomationStrategy(key: string): PublicAutomationStrategy | null {
  return PUBLIC_AUTOMATION_STRATEGY_BY_KEY.get(key) ?? null;
}

export function summarizeAutomationStrategy(strategyJson: string) {
  return previewFromStrategyJson(strategyJson);
}