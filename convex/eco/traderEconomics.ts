import type { Doc } from "../_generated/dataModel";
import {
  BG_TRADER_DOCKING_COST,
  BG_TRADER_MIN_REVENUE_TO_COST_RATIO,
  BG_TRADER_SHIP_HIRE_PER_TURN,
  BG_TRADER_WARN_REVENUE_TO_COST_RATIO,
  COMMODITY_PRICE_DEFAULTS,
} from "../sim/economy/constants";
import { populationToSimUnits } from "../sim/economy/population";

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

function priceFromPressure(
  basePrice: number,
  elasticity: number,
  minMult: number,
  maxMult: number,
  pressure: number,
): number {
  const mult = clamp(1 + pressure * elasticity, minMult, maxMult);
  return basePrice * mult;
}

/** Mirrors weapons shortage signal used in global market snapshots (applyTurnEconomy). */
function weaponsPressure(system: Doc<"gal_systems">): number {
  const simPop = populationToSimUnits(system.population ?? 0);
  const weaponsNeed = Math.max(1, Math.floor(simPop * 0.1));
  const stockWeapons = system.stockWeapons ?? 0;
  return (weaponsNeed * 2 - stockWeapons) / Math.max(1, weaponsNeed);
}

/** Mirrors heavy-metals pressure proxy from applyTurnEconomy aggregate. */
function heavyMetalsPressure(system: Doc<"gal_systems">): number {
  return 1 - clamp(system.resourceRichness, 0, 1);
}

/** Market clearing food price plus optional player import subsidy (credits / food unit). */
export function traderFoodSellPricePerUnit(system: Doc<"gal_systems">): number {
  const market = system.foodPrice ?? COMMODITY_PRICE_DEFAULTS.food.basePrice;
  const subsidy = Math.max(0, system.foodImportSubsidyPerUnit ?? 0);
  return market + subsidy;
}

/**
 * Expected unit price for trading / profitability checks at a colony.
 * Food uses stored `foodPrice` plus {@link gal_systems.foodImportSubsidyPerUnit}; other commodities use the economy pass curves.
 */
export function localCommodityUnitPrice(
  system: Doc<"gal_systems">,
  commodity: string,
): number {
  if (commodity === "food") {
    return traderFoodSellPricePerUnit(system);
  }
  if (commodity === "weapons") {
    const d = COMMODITY_PRICE_DEFAULTS.weapons;
    return priceFromPressure(
      d.basePrice,
      d.elasticity,
      d.minMult,
      d.maxMult,
      weaponsPressure(system),
    );
  }
  if (commodity === "heavy_metals") {
    const d = COMMODITY_PRICE_DEFAULTS.heavy_metals;
    return priceFromPressure(
      d.basePrice,
      d.elasticity,
      d.minMult,
      d.maxMult,
      heavyMetalsPressure(system),
    );
  }
  return COMMODITY_PRICE_DEFAULTS.food.basePrice;
}

/**
 * Ship hire is scaled by `shipCostMult` (god tuning); docking stays fixed.
 * Pass `shipHirePerTurn` / `dockingCost` to override the hardcoded constants (balance sliders).
 */
export function traderTransportCredits(
  travelTurns: number,
  shipCostMult = 1,
  shipHirePerTurn?: number,
  dockingCost?: number,
): number {
  const hireRate = shipHirePerTurn ?? BG_TRADER_SHIP_HIRE_PER_TURN;
  const dock = dockingCost ?? BG_TRADER_DOCKING_COST;
  return hireRate * travelTurns * shipCostMult + dock;
}

export type TraderProfitabilityEval = {
  purchaseCost: number;
  transportCost: number;
  totalCost: number;
  expectedRevenue: number;
  ratio: number;
  passesMinimum: boolean;
  needsWeakProfitWarning: boolean;
};

/**
 * Profitability is measured as expected revenue divided by full expedition cost
 * (cargo purchase + ship hire for all hops + docking).
 *
 * - Below {@link BG_TRADER_MIN_REVENUE_TO_COST_RATIO}: voyage is rejected.
 * - Between minimum and {@link BG_TRADER_WARN_REVENUE_TO_COST_RATIO}: allowed with a warning (admin UI).
 */
export function evaluateTraderProfitability(params: {
  cargoUnits: number;
  buyPricePerUnit: number;
  sellPricePerUnit: number;
  travelTurns: number;
  shipCostMult?: number;
  /** Override absolute ship-hire cost per turn (balance slider). */
  shipHirePerTurn?: number;
  /** Override absolute docking fee (balance slider). */
  dockingCost?: number;
}): TraderProfitabilityEval {
  const shipCostMult = params.shipCostMult ?? 1;
  const purchaseCost = params.cargoUnits * params.buyPricePerUnit;
  const transportCost = traderTransportCredits(
    params.travelTurns,
    shipCostMult,
    params.shipHirePerTurn,
    params.dockingCost,
  );
  const totalCost = purchaseCost + transportCost;
  const expectedRevenue = params.cargoUnits * params.sellPricePerUnit;
  const ratio = totalCost > 0 ? expectedRevenue / totalCost : 0;
  const passesMinimum = ratio >= BG_TRADER_MIN_REVENUE_TO_COST_RATIO;
  const needsWeakProfitWarning =
    passesMinimum && ratio < BG_TRADER_WARN_REVENUE_TO_COST_RATIO;

  return {
    purchaseCost,
    transportCost,
    totalCost,
    expectedRevenue,
    ratio,
    passesMinimum,
    needsWeakProfitWarning,
  };
}
