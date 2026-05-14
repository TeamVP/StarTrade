import { describe, expect, test } from "vitest";
import {
  resolveFullCombatRound,
  resolveOpeningStrike,
  resolveTwoEmpireBattle,
} from "./combat";

const baseCollateralState = {
  stockFood: 500,
  stockWeapons: 160,
  stockResearch: 120,
  population: 50_000_000,
};

describe("resolveTwoEmpireBattle", () => {
  test("opening strike only damages attackers", () => {
    const result = resolveOpeningStrike({
      attackerShips: 100,
      defenderShips: 50,
      isDefenderHomeworld: false,
    });

    expect(result.phase).toBe("opening");
    expect(result.attackerLosses).toBeGreaterThan(0);
    expect(result.defenderLosses).toBe(0);
    expect(result.defenderShipsAfter).toBe(50);
  });

  test("full rounds damage both sides and can apply collateral", () => {
    const result = resolveFullCombatRound({
      attackerShips: 120,
      defenderShips: 80,
      seed: "full-round",
      systemId: "sigma",
      turnNumber: 4,
      attackerEmpireId: "attacker",
      defenderEmpireId: "defender",
      roundNumber: 1,
      isDefenderHomeworld: false,
      collateralState: baseCollateralState,
    });

    expect(result.round.phase).toBe("full");
    expect(result.round.attackerLosses).toBeGreaterThan(0);
    expect(result.round.defenderLosses).toBeGreaterThan(0);
    expect(result.collateralState.stockFood).toBeGreaterThanOrEqual(0);
  });

  test("lets overwhelming attackers conquer defenders", () => {
    const result = resolveTwoEmpireBattle({
      attacker: { empireId: "attacker", ships: 500 },
      defender: { empireId: "defender", ships: 10 },
      seed: "attacker-win",
      systemId: "alpha",
      turnNumber: 3,
      isDefenderHomeworld: false,
      collateralState: baseCollateralState,
    });

    expect(result.winnerEmpireId).toBe("attacker");
    expect(result.attackerShipsRemaining).toBeGreaterThan(0);
    expect(result.defenderShipsRemaining).toBe(0);
  });

  test("preserves the baseline defender advantage", () => {
    const result = resolveTwoEmpireBattle({
      attacker: { empireId: "attacker", ships: 100 },
      defender: { empireId: "defender", ships: 100 },
      seed: "defender-hold",
      systemId: "beta",
      turnNumber: 5,
      isDefenderHomeworld: false,
      collateralState: baseCollateralState,
    });

    expect(result.winnerEmpireId).toBe("defender");
    expect(result.defenderShipsRemaining).toBeGreaterThan(0);
  });

  test("can destroy both sides in a close fight", () => {
    const result = resolveTwoEmpireBattle({
      attacker: { empireId: "attacker", ships: 2 },
      defender: { empireId: "defender", ships: 1 },
      seed: "mutual-destruction",
      systemId: "gamma",
      turnNumber: 7,
      isDefenderHomeworld: false,
      collateralState: baseCollateralState,
    });

    expect(result.winnerEmpireId).toBeNull();
    expect(result.attackerShipsRemaining).toBe(0);
    expect(result.defenderShipsRemaining).toBe(0);
  });

  test("applies collateral damage without dropping resources below zero", () => {
    const result = resolveTwoEmpireBattle({
      attacker: { empireId: "attacker", ships: 200 },
      defender: { empireId: "defender", ships: 80 },
      seed: "collateral-check",
      systemId: "delta",
      turnNumber: 9,
      isDefenderHomeworld: false,
      collateralState: {
        stockFood: 1,
        stockWeapons: 1,
        stockResearch: 1,
        population: 1,
      },
    });

    expect(result.rounds.some((round) => round.phase === "full")).toBe(true);
    expect(result.collateralState.stockFood).toBeGreaterThanOrEqual(0);
    expect(result.collateralState.stockWeapons).toBeGreaterThanOrEqual(0);
    expect(result.collateralState.stockResearch).toBeGreaterThanOrEqual(0);
    expect(result.collateralState.population).toBeGreaterThanOrEqual(0);
  });
});
