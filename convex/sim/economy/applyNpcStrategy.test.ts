import { describe, expect, test } from "vitest";
import {
  applyFoodShortageProductionShift,
  applyShipProductionBoost,
  hasManualRouteOverride,
  mergeStandingOrderCandidates,
} from "./applyNpcStrategy";
import type { Id } from "../../_generated/dataModel";

const response = {
  enabled: true,
  shiftPctPerTurn: 15,
  minShipsPct: 0,
  maxFoodPct: 100,
  recoveryTurns: 0,
};

describe("applyFoodShortageProductionShift", () => {
  test("moves 15 points from ships to food for each shortage turn", () => {
    expect(
      applyFoodShortageProductionShift({
        baseFoodPct: 60,
        baseShipsPct: 40,
        baseResearchPct: 0,
        shortageTurns: 2,
        response,
      }),
    ).toEqual({
      emphasisFood: 90,
      emphasisShips: 10,
      emphasisResearch: 0,
    });
  });

  test("does not shift below the configured ship floor", () => {
    expect(
      applyFoodShortageProductionShift({
        baseFoodPct: 60,
        baseShipsPct: 40,
        baseResearchPct: 0,
        shortageTurns: 4,
        response: { ...response, minShipsPct: 10 },
      }),
    ).toEqual({
      emphasisFood: 90,
      emphasisShips: 10,
      emphasisResearch: 0,
    });
  });

  test("returns to the base mix when the shortage streak is over", () => {
    expect(
      applyFoodShortageProductionShift({
        baseFoodPct: 60,
        baseShipsPct: 40,
        baseResearchPct: 0,
        shortageTurns: 0,
        response,
      }),
    ).toEqual({
      emphasisFood: 60,
      emphasisShips: 40,
      emphasisResearch: 0,
    });
  });

  test("keeps the last shortage shift during configured recovery turns", () => {
    expect(
      applyFoodShortageProductionShift({
        baseFoodPct: 60,
        baseShipsPct: 40,
        baseResearchPct: 0,
        shortageTurns: 0,
        lastShortageTurn: 10,
        lastShortageTurns: 2,
        currentTurn: 12,
        response: { ...response, recoveryTurns: 2 },
      }),
    ).toEqual({
      emphasisFood: 90,
      emphasisShips: 10,
      emphasisResearch: 0,
    });
  });

  test("returns to the base mix after recovery turns expire", () => {
    expect(
      applyFoodShortageProductionShift({
        baseFoodPct: 60,
        baseShipsPct: 40,
        baseResearchPct: 0,
        shortageTurns: 0,
        lastShortageTurn: 10,
        lastShortageTurns: 2,
        currentTurn: 13,
        response: { ...response, recoveryTurns: 2 },
      }),
    ).toEqual({
      emphasisFood: 60,
      emphasisShips: 40,
      emphasisResearch: 0,
    });
  });
});

describe("applyShipProductionBoost", () => {
  test("moves available food effort into ship production", () => {
    expect(
      applyShipProductionBoost({
        baseFoodPct: 60,
        baseShipsPct: 40,
        baseResearchPct: 0,
        boostPct: 15,
      }),
    ).toEqual({
      emphasisFood: 45,
      emphasisShips: 55,
      emphasisResearch: 0,
    });
  });

  test("does not exceed the non-research ship cap", () => {
    expect(
      applyShipProductionBoost({
        baseFoodPct: 10,
        baseShipsPct: 60,
        baseResearchPct: 30,
        boostPct: 20,
      }),
    ).toEqual({
      emphasisFood: 0,
      emphasisShips: 70,
      emphasisResearch: 30,
    });
  });
});

describe("mergeStandingOrderCandidates", () => {
  const o = "originSys" as Id<"gal_systems">;
  const d1 = "dst1" as Id<"gal_systems">;
  const d2 = "dst2" as Id<"gal_systems">;

  test("keeps the higher-precedence purpose when they conflict", () => {
    const corridor = {
      originSystemId: o,
      destinationSystemId: d1,
      dispatchPct: 50,
      purpose: "priorityOwnedCorridor" as const,
    };
    const staging = {
      originSystemId: o,
      destinationSystemId: d2,
      dispatchPct: 90,
      purpose: "priorityEnemyStaging" as const,
    };
    expect(mergeStandingOrderCandidates(staging, corridor)).toEqual(corridor);
    expect(mergeStandingOrderCandidates(corridor, staging)).toEqual(corridor);
  });

  test("lets priorityApproach beat owned corridors at the same origin", () => {
    const corridor = {
      originSystemId: o,
      destinationSystemId: d1,
      dispatchPct: 95,
      purpose: "priorityOwnedCorridor" as const,
    };
    const approach = {
      originSystemId: o,
      destinationSystemId: d2,
      dispatchPct: 80,
      purpose: "priorityApproach" as const,
    };
    expect(mergeStandingOrderCandidates(corridor, approach)).toEqual(approach);
    expect(mergeStandingOrderCandidates(approach, corridor)).toEqual(approach);
  });
});

describe("hasManualRouteOverride", () => {
  const origin = "origin" as Id<"gal_systems">;
  const otherOrigin = "otherOrigin" as Id<"gal_systems">;

  test("manual standing routes override strategy automation for the same origin", () => {
    expect(
      hasManualRouteOverride(
        [{ originSystemId: origin, managedByStrategy: undefined }],
        origin,
      ),
    ).toBe(true);
  });

  test("strategy-managed routes do not count as manual overrides", () => {
    expect(
      hasManualRouteOverride(
        [{ originSystemId: origin, managedByStrategy: true }],
        origin,
      ),
    ).toBe(false);
  });

  test("manual routes only override automation at their own origin", () => {
    expect(
      hasManualRouteOverride(
        [{ originSystemId: otherOrigin, managedByStrategy: undefined }],
        origin,
      ),
    ).toBe(false);
  });
});
