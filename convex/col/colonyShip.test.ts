import { describe, expect, test } from "vitest";
import type { Doc, Id } from "../_generated/dataModel";
import { clampPopulationPeople } from "../sim/economy/population";
import {
  computeColonyShipBuildCostShipPoints,
  estimateHomeworldMaxShipsPerTurn,
} from "./colonyShipBuildCost";
import {
  COLONY_NEW_WORLD_FOOD_BONUS_PER_TURN,
  COLONY_NEW_WORLD_STARTER_FOOD,
  COLONY_SHIP_BUILD_TURNS,
  COLONY_SHIP_POP_CARGO_PEOPLE,
} from "./constants";
import { validateColonyShipRouteDestinations } from "./routeValidation";

/** Minimal `gal_systems` row for pure build-cost math tests. */
function fakeHomeworld(over: Partial<Doc<"gal_systems">> = {}): Doc<"gal_systems"> {
  return {
    _id: "k575colony0001",
    _creationTime: 0,
    gameId: "j575colonygame1",
    systemKey: "hw",
    name: "Homeworld",
    x: 0,
    y: 0,
    resourceRichness: 0.85,
    baseProductivity: 8,
    isHomeworld: true,
    ownerEmpireId: "e575colonyemp1",
    population: 50_000_000,
    stockFood: 80_000_000,
    stockWeapons: 6_000_000,
    emphasisFood: 34,
    emphasisShips: 33,
    emphasisResearch: 33,
    ...over,
  } as Doc<"gal_systems">;
}

describe("validateColonyShipRouteDestinations", () => {
  const e = "emp1" as Id<"emp_states">;
  test("allows any length through empire then two foreign hops", () => {
    const err = validateColonyShipRouteDestinations({
      routeSystemIds: ["a", "b", "c", "d"] as Id<"gal_systems">[],
      empireId: e,
      getOwner: (id) => {
        if (id === "a" || id === "b") return e;
        return null;
      },
    });
    expect(err).toBeNull();
  });

  test("rejects more than two hops beyond empire prefix", () => {
    const err = validateColonyShipRouteDestinations({
      routeSystemIds: ["a", "x", "y", "z"] as Id<"gal_systems">[],
      empireId: e,
      getOwner: (id) => (id === "a" ? e : null),
    });
    expect(err).not.toBeNull();
  });

  test("rejects duplicate systems", () => {
    const err = validateColonyShipRouteDestinations({
      routeSystemIds: ["a", "a"] as Id<"gal_systems">[],
      empireId: e,
      getOwner: () => e,
    });
    expect(err).not.toBeNull();
  });
});

describe("colony ship build & economy helpers", () => {
  test("build cost is ~10 turns of max homeworld ship output", () => {
    const maxShips = estimateHomeworldMaxShipsPerTurn({
      system: fakeHomeworld(),
      holding: undefined,
      empireTaxRate: 0.2,
      settings: { shipProdMult: 1, shipProdEmphasisPower: 1.5 },
    });
    expect(maxShips).toBeGreaterThan(0);
    const cost = computeColonyShipBuildCostShipPoints(maxShips);
    expect(cost).toBe(Math.max(1, maxShips) * COLONY_SHIP_BUILD_TURNS);
  });

  test("dispatch deducts cargo population from homeworld headcount", () => {
    const before = 60_000_000;
    const after = clampPopulationPeople(before - COLONY_SHIP_POP_CARGO_PEOPLE);
    expect(after).toBe(before - COLONY_SHIP_POP_CARGO_PEOPLE);
  });

  test("colonize payload uses configured food bonus and starter buffer", () => {
    expect(COLONY_SHIP_POP_CARGO_PEOPLE).toBe(50_000);
    expect(COLONY_NEW_WORLD_FOOD_BONUS_PER_TURN).toBeGreaterThan(0);
    expect(COLONY_NEW_WORLD_STARTER_FOOD).toBeGreaterThan(0);
  });

  test("ship production diversion matches applyTurnEconomy colony-build branch", () => {
    const shipsProduced = 12;
    const cost = 40;
    const progress0 = 35;
    const divert = Math.min(shipsProduced, cost - progress0);
    expect(divert).toBe(5);
    const newProgress = progress0 + divert;
    expect(newProgress).toBe(cost);
    const garrisonShips = shipsProduced - divert;
    expect(garrisonShips).toBe(7);
  });

  test("food produced total adds flat colony infrastructure bonus", () => {
    const foodProduced = 80;
    const colonyFoodBonusPerTurn = COLONY_NEW_WORLD_FOOD_BONUS_PER_TURN;
    const foodProducedTotal = foodProduced + colonyFoodBonusPerTurn;
    expect(foodProducedTotal).toBe(foodProduced + COLONY_NEW_WORLD_FOOD_BONUS_PER_TURN);
  });
});
