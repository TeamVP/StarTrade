import type { Doc } from "../_generated/dataModel";
import type { GameSettings } from "../sim/economy/gameSettings";
import {
  DEFAULT_EMPIRE_TAX_RATE,
  FOOD_PER_POP,
  HOMEWORLD_PROD_MULT,
  MAX_EMPIRE_TAX_RATE,
  MAX_WEAPONS_BONUS,
  SHORTAGE_PROD_MULT,
  SHORTAGE_THRESHOLD_RATIO,
} from "../sim/economy/constants";
import {
  COLONY_SHIP_BUILD_TURNS,
} from "./constants";

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

function damagePenaltyMultiplier(
  populationPeople: number,
  recentDamagePopulationPeople: number,
): number {
  const denom = Math.max(1, populationPeople + recentDamagePopulationPeople);
  return 1 - Math.min(0.5, recentDamagePopulationPeople / denom);
}

/**
 * Max military ships/turn this homeworld could produce if 100% effort went to ships
 * (same formula as {@link applyTurnEconomy} `shipsProduced` with w.ships = 1).
 */
export function estimateHomeworldMaxShipsPerTurn(params: {
  system: Doc<"gal_systems">;
  holding: Doc<"emp_system_holdings"> | undefined;
  empireTaxRate: number;
  settings: Pick<GameSettings, "shipProdMult">;
}): number {
  const { system, holding, empireTaxRate, settings } = params;
  const r = clamp(empireTaxRate, 0, MAX_EMPIRE_TAX_RATE);
  const prodAfterTax = 1 - r;
  const productionModifier = holding?.productionModifier ?? 1;

  const populationPeople = Math.max(0, Math.floor(system.population ?? 0));
  const simPop = Math.max(0, populationPeople) / 1_000_000;
  const stockFood = Math.max(0, system.stockFood ?? 0);
  const stockWeapons = Math.max(0, system.stockWeapons ?? 0);

  const baseProd =
    system.baseProductivity ??
    clamp(Math.round(3 + system.resourceRichness * 7), 1, 10);

  const shortageMult =
    stockFood < simPop * FOOD_PER_POP * SHORTAGE_THRESHOLD_RATIO
      ? SHORTAGE_PROD_MULT
      : 1;

  const damageProdMult = damagePenaltyMultiplier(
    populationPeople,
    system.recentDamagePopulation ?? 0,
  );

  const wShips = 1;
  const weaponsNeed = Math.max(1, Math.floor(simPop * 0.1));
  const weaponsCoverage = Math.min(1, stockWeapons / weaponsNeed);
  const weaponsBonusMult = 1 + MAX_WEAPONS_BONUS * weaponsCoverage * wShips;

  const effectiveProductivity = Math.max(
    0,
    baseProd *
      HOMEWORLD_PROD_MULT *
      productionModifier *
      shortageMult *
      damageProdMult *
      prodAfterTax,
  );

  return Math.max(
    0,
    Math.floor(
      effectiveProductivity * wShips * weaponsBonusMult * settings.shipProdMult,
    ),
  );
}

export function computeColonyShipBuildCostShipPoints(maxShipsPerTurn: number): number {
  return Math.max(1, maxShipsPerTurn) * COLONY_SHIP_BUILD_TURNS;
}

export function defaultEmpireTaxRateForBuild(empire: Doc<"emp_states">): number {
  return empire.empireTaxRate ?? DEFAULT_EMPIRE_TAX_RATE;
}
