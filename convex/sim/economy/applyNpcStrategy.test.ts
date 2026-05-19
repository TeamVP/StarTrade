import { describe, expect, test } from "vitest";
import {
  applyFightAttractionAttackAdvantage,
  applyFightAttractionDispatchBoost,
  applyFoodShortageProductionShift,
  findIntruderDetection,
  applyShipProductionBoost,
  hasManualRouteOverride,
  mergeStandingOrderCandidates,
  missionRevealShouldTrigger,
} from "./applyNpcStrategy";
import type { Doc, Id } from "../../_generated/dataModel";

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

function makeSystem(params: {
  id: string;
  ownerEmpireId: Id<"emp_states"> | null;
  underAttack?: boolean;
}): Doc<"gal_systems"> {
  return {
    _id: params.id as Id<"gal_systems">,
    _creationTime: 0,
    gameId: "game" as Id<"sim_games">,
    systemKey: params.id,
    name: params.id,
    x: 0,
    y: 0,
    resourceRichness: 1,
    isHomeworld: false,
    population: 0,
    stockFood: 0,
    stockResearch: 0,
    stockWeapons: 0,
    localTreasury: 0,
    ownerEmpireId: params.ownerEmpireId,
    ownerGameActorId: undefined,
    underAttack: params.underAttack,
    lastContestedTurn: undefined,
  } as Doc<"gal_systems">;
}

function makeEmpire(overrides?: Partial<Doc<"emp_states">>): Doc<"emp_states"> {
  return {
    _id: "empireA" as Id<"emp_states">,
    _creationTime: 0,
    gameId: "game" as Id<"sim_games">,
    empireKey: "empireA",
    name: "Empire A",
    colorHex: "#ffffff",
    controller: "npc",
    isCollapsed: false,
    treasury: 0,
    homeSystemId: null,
    missionStartsHidden: false,
    missionRevealedAtTurn: 0,
    ...overrides,
  } as Doc<"emp_states">;
}

describe("findIntruderDetection", () => {
  const empireA = "empireA" as Id<"emp_states">;
  const empireB = "empireB" as Id<"emp_states">;
  const owned = makeSystem({ id: "owned", ownerEmpireId: empireA });
  const border = makeSystem({ id: "border", ownerEmpireId: null });
  const deep = makeSystem({ id: "deep", ownerEmpireId: empireB });
  const adjacency = new Map<string, Id<"gal_systems">[]>([
    [owned._id, [border._id]],
    [border._id, [owned._id, deep._id]],
    [deep._id, [border._id]],
  ]);
  const systemsById = new Map<Id<"gal_systems">, Doc<"gal_systems">>([
    [owned._id, owned],
    [border._id, border],
    [deep._id, deep],
  ]);

  test("detects foreign fleets within route depth", () => {
    const strengthBySystem = new Map<string, Map<string, number>>([
      [border._id, new Map([[empireB, 12]])],
    ]);

    expect(
      findIntruderDetection({
        empireId: empireA,
        ownedSystems: [owned],
        systemsById,
        adjacency,
        strengthBySystem,
        routeSteps: 1,
        requireNewEmpire: false,
      }),
    ).toEqual({
      detected: true,
      systemId: border._id,
      intruderEmpireIds: [empireB],
    });
  });

  test("can ignore already-adjacent empires when requireNewEmpire is true", () => {
    const adjacentEnemyBorder = makeSystem({ id: "enemyBorder", ownerEmpireId: empireB });
    const adjacentAdjacency = new Map<string, Id<"gal_systems">[]>([
      [owned._id, [adjacentEnemyBorder._id]],
      [adjacentEnemyBorder._id, [owned._id]],
    ]);
    const adjacentSystemsById = new Map<Id<"gal_systems">, Doc<"gal_systems">>([
      [owned._id, owned],
      [adjacentEnemyBorder._id, adjacentEnemyBorder],
    ]);
    const strengthBySystem = new Map<string, Map<string, number>>([
      [adjacentEnemyBorder._id, new Map([[empireB, 12]])],
    ]);

    expect(
      findIntruderDetection({
        empireId: empireA,
        ownedSystems: [owned],
        systemsById: adjacentSystemsById,
        adjacency: adjacentAdjacency,
        strengthBySystem,
        routeSteps: 1,
        requireNewEmpire: true,
      }).detected,
    ).toBe(false);
  });
});

describe("missionRevealShouldTrigger", () => {
  test("reveals hidden empires when turn threshold is met", () => {
    expect(
      missionRevealShouldTrigger({
        empire: makeEmpire({
          missionStartsHidden: true,
          missionRevealedAtTurn: undefined,
          missionRevealTriggerMode: "turn",
          missionRevealTurn: 4,
        }),
        turnNumber: 4,
        ownedSystems: [],
        adjacency: new Map(),
        systemsById: new Map(),
        strengthBySystem: new Map(),
      }).revealed,
    ).toBe(true);
  });

  test("reveals hidden empires on intruder detection", () => {
    const empireA = "empireA" as Id<"emp_states">;
    const empireB = "empireB" as Id<"emp_states">;
    const owned = makeSystem({ id: "owned2", ownerEmpireId: empireA });
    const border = makeSystem({ id: "border2", ownerEmpireId: null });
    const adjacency = new Map<string, Id<"gal_systems">[]>([
      [owned._id, [border._id]],
      [border._id, [owned._id]],
    ]);
    const systemsById = new Map<Id<"gal_systems">, Doc<"gal_systems">>([
      [owned._id, owned],
      [border._id, border],
    ]);
    const strengthBySystem = new Map<string, Map<string, number>>([
      [border._id, new Map([[empireB, 10]])],
    ]);

    const reveal = missionRevealShouldTrigger({
      empire: makeEmpire({
        missionStartsHidden: true,
        missionRevealedAtTurn: undefined,
        missionRevealTriggerMode: "intruder_detection",
        missionRevealRouteSteps: 1,
        missionRevealRequireNewEmpire: false,
      }),
      turnNumber: 1,
      ownedSystems: [owned],
      adjacency,
      systemsById,
      strengthBySystem,
    });

    expect(reveal.revealed).toBe(true);
    expect(reveal.systemId).toBe(border._id);
  });
});

describe("fight attraction", () => {
  test("boosts dispatch percentages for more aggressive responses", () => {
    expect(applyFightAttractionDispatchBoost(60, 3)).toBe(84);
  });

  test("lowers attack advantage thresholds but keeps a floor", () => {
    expect(applyFightAttractionAttackAdvantage(1.6, 3)).toBeCloseTo(1.36);
    expect(applyFightAttractionAttackAdvantage(1.1, 3)).toBe(1.05);
  });
});
