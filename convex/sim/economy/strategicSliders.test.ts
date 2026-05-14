import { describe, expect, it } from "vitest";
import {
  buildRuntimeStrategyAutomation,
  computeStrategicSliderDefaults,
  resolveStrategicSliders,
} from "./strategicSliders";
import type { PriorityStarPolicy } from "./strategicSliders";

function basePriorityStarPolicy(
  overrides: Partial<PriorityStarPolicy> = {},
): PriorityStarPolicy {
  return {
    enabled: true,
    neutralDispatchPct: 80,
    stagingDispatchPct: 70,
    enemyDispatchPct: 75,
    approachDispatchPct: 80,
    minDefenseAverageFleetMult: 1,
    shipBoostPct: 10,
    minFoodStockpileTurns: 2,
    ownedCorridorStandingOrdersEnabled: false,
    ownedCorridorDispatchPct: 72,
    ...overrides,
  };
}

describe("computeStrategicSliderDefaults", () => {
  it("maps balanced stance to medium military", () => {
    const d = computeStrategicSliderDefaults({
      earlyRush: true,
      reserveShipsPct: 30,
      priorityStarPolicy: { enabled: true, shipBoostPct: 10 },
      reinforceAttackedSystems: true,
      emergencyReserveShipsPct: 35,
      stance: "balanced",
    });
    expect(d.militaryAggression).toBe("medium");
  });

  it("lowers expansion when earlyRush is false", () => {
    const d = computeStrategicSliderDefaults({
      earlyRush: false,
      reserveShipsPct: 20,
      priorityStarPolicy: { enabled: false, shipBoostPct: 0 },
      reinforceAttackedSystems: true,
      emergencyReserveShipsPct: 20,
      stance: "aggressive",
    });
    expect(d.expansion).toBe("low");
  });
});

describe("buildRuntimeStrategyAutomation", () => {
  it("scales attack advantage with military aggression", () => {
    const priorityStarPolicy = basePriorityStarPolicy();
    const base = {
      attackAdvantageRequired: 10,
      reserveShipsPct: 30,
      emergencyReserveShipsPct: 25,
      borderReserveShipsPct: 40,
      priorityStarPolicy,
    };
    const low = buildRuntimeStrategyAutomation({
      automation: base,
      sliders: resolveStrategicSliders(
        {
          militaryAggression: "lowest",
          expansion: "medium",
          defensivePosture: "medium",
          priorityOperations: "medium",
          economicMobilization: "medium",
        },
        undefined,
      ),
    });
    const high = buildRuntimeStrategyAutomation({
      automation: base,
      sliders: resolveStrategicSliders(
        {
          militaryAggression: "highest",
          expansion: "medium",
          defensivePosture: "medium",
          priorityOperations: "medium",
          economicMobilization: "medium",
        },
        undefined,
      ),
    });
    expect(high.attackAdvantageRequired).toBeLessThan(low.attackAdvantageRequired);
  });

  it("keeps priority star ship boost at zero when strategy boost is zero", () => {
    const r = buildRuntimeStrategyAutomation({
      automation: {
        attackAdvantageRequired: 4,
        reserveShipsPct: 30,
        emergencyReserveShipsPct: 20,
        borderReserveShipsPct: 40,
        priorityStarPolicy: basePriorityStarPolicy({ shipBoostPct: 0 }),
      },
      sliders: resolveStrategicSliders(
        {
          militaryAggression: "high",
          expansion: "high",
          defensivePosture: "high",
          priorityOperations: "highest",
          economicMobilization: "highest",
        },
        undefined,
      ),
    });
    expect(r.priorityStarPolicy.shipBoostPct).toBe(0);
  });
});
