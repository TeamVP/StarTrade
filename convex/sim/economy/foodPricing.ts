import type { GameSettings } from "./gameSettings";
import {
  FOOD_PRICE_BASE,
  FOOD_PRICE_ELASTICITY,
  FOOD_PRICE_MAX_MULT,
  FOOD_PRICE_MIN_MULT,
} from "./constants";

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

/**
 * 0–1 "desperation" signal: severe shortage / starvation drives food prices toward the admin cap.
 * Combines stock-vs-demand pressure with immediate net food deficit when consumption exceeds availability.
 */
export function starvationPriceStress(
  foodDemand: number,
  stockFood: number,
  /** Negative when foodAvailable - demand is negative before starvation resolves this turn. */
  foodNet?: number,
): number {
  const demand = Math.max(1, foodDemand);
  const pressure = (demand - Math.max(0, stockFood)) / demand;
  const netStress =
    foodNet !== undefined && foodNet < 0 ? Math.min(1, (-foodNet) / demand) : 0;
  return clamp(Math.max(pressure, netStress), 0, 1);
}

/**
 * Local food credits/unit price for an inhabited economy-owned world.
 *
 * Balance sliders:
 * - `foodStockpileMaxPerPop`: when `stockFood > demand × this`, the market is in oversupply
 *   and prices are driven to minimum (below this threshold, normal elasticity applies).
 * - `foodStockpileMinPerPop`: when `stockFood < demand × this`, food stress activates and
 *   prices rise sharply scaled by `foodStressFactor`.
 * - `foodStressFactor`: multiplier on price growth rate below the minimum threshold.
 * - `starvationFoodPriceCapMult`: ceiling on price multiplier during crises (~100× base).
 */
export function computeSystemFoodPrice(params: {
  stockFood: number;
  foodDemand: number;
  /** Same-turn net food balance before starvation bookkeeping (`foodAvailable − demand`). */
  foodNet?: number;
  settings: Pick<
    GameSettings,
    | "foodPriceElasticityMult"
    | "starvationFoodPriceCapMult"
    | "foodStockpileMaxPerPop"
    | "foodStockpileMinPerPop"
    | "foodStressFactor"
    | "foodBasePrice"
  >;
}): number {
  const demand = Math.max(1, params.foodDemand);
  const stock = Math.max(0, params.stockFood);

  const maxThreshold = demand * params.settings.foodStockpileMaxPerPop;
  const minThreshold = demand * params.settings.foodStockpileMinPerPop;
  const isOversupply = stock >= maxThreshold;
  const isStressed = stock < minThreshold;

  // Base pressure: positive = scarce (prices rise), negative = surplus (prices fall).
  let pressure: number;
  if (isOversupply) {
    // Force deep negative pressure so the price floor is reached (≈ −10%/turn behaviour).
    pressure = -2.0;
  } else {
    pressure = (demand - stock) / demand;
    if (isStressed && params.settings.foodStressFactor > 1) {
      // Below minimum: amplify upward pressure proportional to how far below minimum we are.
      const belowFraction = minThreshold > 0 ? (minThreshold - stock) / minThreshold : 1;
      const boost = 1 + (params.settings.foodStressFactor - 1) * belowFraction;
      pressure = pressure * boost;
    }
  }

  // Starvation stress 0–1 signal drives the extreme-price cap.
  let stress = starvationPriceStress(demand, stock, params.foodNet);
  if (isStressed && params.settings.foodStressFactor > 1) {
    const belowFraction = minThreshold > 0 ? (minThreshold - stock) / minThreshold : 1;
    stress = clamp(stress * (1 + (params.settings.foodStressFactor - 1) * belowFraction), 0, 1);
  }

  const capMult = params.settings.starvationFoodPriceCapMult;

  const effectiveMaxMult =
    FOOD_PRICE_MAX_MULT + Math.max(0, capMult - FOOD_PRICE_MAX_MULT) * stress;

  const elasticityBoost =
    1 + stress * Math.min(4, (capMult / FOOD_PRICE_MAX_MULT - 1) * 0.35);
  const elasticity =
    FOOD_PRICE_ELASTICITY * params.settings.foodPriceElasticityMult * elasticityBoost;

  // Use the per-game base price if set; fall back to the hardcoded constant.
  const basePrice = Math.round(params.settings.foodBasePrice) || FOOD_PRICE_BASE;

  return priceFromPressure(
    basePrice,
    elasticity,
    FOOD_PRICE_MIN_MULT,
    effectiveMaxMult,
    pressure,
  );
}

/**
 * Food held above the stockpile ceiling (`foodDemand × foodStockpileMaxPerPop`).
 * Background traders may purchase only from this surplus pool (not from stock at or below the cap).
 */
export function foodOversupplyUnits(params: {
  stockFood: number;
  foodDemand: number;
  settings: Pick<GameSettings, "foodStockpileMaxPerPop">;
}): number {
  const demand = Math.max(1, params.foodDemand);
  const maxThreshold = demand * params.settings.foodStockpileMaxPerPop;
  return Math.max(0, Math.max(0, params.stockFood) - maxThreshold);
}
