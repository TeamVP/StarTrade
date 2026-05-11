/**
 * Mirrors convex/sim/economy/constants.ts + applyTurnEconomy food math for UI previews.
 * If sim formulas change, update both places.
 */
export const POPULATION_PEOPLE_PER_SIM_UNIT = 1_000_000;
export const FOOD_PER_POP = 10;
export const FOOD_PROD_PER_POP = 5.88;
export const FOOD_PROD_MIN_FLOOR_FRACTION = 0.5;
/** Sync with convex/sim/economy/constants.ts */
export const FOOD_EMPHASIS_REFERENCE_SHARE = 1 / 3;
export const HOMEWORLD_PROD_MULT = 1.5;
/** Shown when `foodPrice` is not yet written (before first economy pass). */
export const FOOD_PRICE_DEFAULT_CR = 10;

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

export function damagePenaltyMultiplier(
  populationPeople: number,
  recentDamagePopulationPeople: number,
): number {
  const denom = Math.max(1, populationPeople + recentDamagePopulationPeople);
  return 1 - Math.min(0.5, recentDamagePopulationPeople / denom);
}

export function defaultBaseProductivity(resourceRichness: number): number {
  return clamp(Math.round(3 + resourceRichness * 7), 1, 10);
}

/** Sim-population scalar (≈ millions of people). */
export function populationToSimUnits(people: number): number {
  return Math.max(0, people) / POPULATION_PEOPLE_PER_SIM_UNIT;
}

export type FoodEmphasisPreview = {
  simPop: number;
  /** Food units demanded per turn for the whole colony (matches resolve pass). */
  demandTotal: number;
  /** Raw food production before subsistence floor (same formula as applyTurnEconomy). */
  rawProdTotal: number;
  /** After max(raw, subsistence floor scaled by food emphasis vs {@link FOOD_EMPHASIS_REFERENCE_SHARE}). */
  effectiveProdTotal: number;
  /** Demand per 1M residents (food units / turn per M pop). */
  demandPerM: number;
  /** Raw local production per 1M residents at current emphasis. */
  rawProdPerM: number;
  /** Effective production per 1M after subsistence floor. */
  effectiveProdPerM: number;
  /** Net food units / turn for the colony (effective prod − demand). */
  netTotal: number;
};

/**
 * Preview local food production vs demand using the same coefficients as the sim
 * (homeworld bonus, damage to pop, optional productionModifier default 1, foodProdMult 1).
 */
export function previewColonyFoodFlows(params: {
  populationPeople: number;
  resourceRichness: number;
  baseProductivity?: number;
  emphasisFood: number;
  emphasisShips: number;
  emphasisResearch: number;
  isHomeworld: boolean;
  recentDamagePopulation?: number;
  /** Holding productionModifier; defaults to 1 if unknown. */
  productionModifier?: number;
}): FoodEmphasisPreview {
  const pop = Math.max(0, params.populationPeople);
  const simPop = populationToSimUnits(pop);
  const baseProd =
    params.baseProductivity ?? defaultBaseProductivity(params.resourceRichness);
  const f = params.emphasisFood;
  const s = params.emphasisShips;
  const r = params.emphasisResearch;
  const sum = f + s + r;
  const wFood = sum > 0 ? f / sum : 1 / 3;

  const homeworldProdMult = params.isHomeworld ? HOMEWORLD_PROD_MULT : 1;
  const productionModifier = params.productionModifier ?? 1;
  const damageProdMult = damagePenaltyMultiplier(
    pop,
    params.recentDamagePopulation ?? 0,
  );

  const demandTotal = simPop * FOOD_PER_POP;
  const rawProdTotal =
    simPop *
    baseProd *
    FOOD_PROD_PER_POP *
    wFood *
    homeworldProdMult *
    productionModifier *
    damageProdMult;
  const subsistenceShare = Math.min(1, wFood / FOOD_EMPHASIS_REFERENCE_SHARE);
  const foodProdFloor = Math.ceil(
    demandTotal * FOOD_PROD_MIN_FLOOR_FRACTION * subsistenceShare,
  );
  const effectiveProdTotal = Math.max(Math.floor(rawProdTotal), foodProdFloor);

  const denom = Math.max(simPop, 1e-9);
  return {
    simPop,
    demandTotal,
    rawProdTotal,
    effectiveProdTotal,
    demandPerM: demandTotal / denom,
    rawProdPerM: rawProdTotal / denom,
    effectiveProdPerM: effectiveProdTotal / denom,
    netTotal: effectiveProdTotal - demandTotal,
  };
}

/**
 * Compact "Prod / demand" scores for the star panel.
 * Demand is fixed at {@link FOOD_PANEL_DEMAND_SCORE} = "100% of this colony's need per turn".
 * Production scales the same way: at exact balance you see `5.0 / 5.0 (+0.0)`; surplus shows +net.
 */
export const FOOD_PANEL_DEMAND_SCORE = 5;

export function foodProdDemandDisplay(preview: FoodEmphasisPreview): {
  prod: number;
  demand: number;
  net: number;
} {
  const d = Math.max(preview.demandTotal, 1e-9);
  const prod = FOOD_PANEL_DEMAND_SCORE * (preview.effectiveProdTotal / d);
  const demand = FOOD_PANEL_DEMAND_SCORE;
  const net = prod - demand;
  return { prod, demand, net };
}

/** Same demand floor as `computeSystemFoodPrice` / background trade estimates. */
export function foodDemandForStockThresholds(preview: FoodEmphasisPreview): number {
  return Math.max(1, preview.demandTotal);
}

export type FoodStockpileBand = "below" | "acceptable" | "oversupply";

/**
 * Band vs min/max multiples of one-turn food demand (matches economy food pricing).
 */
export function foodStockpileBand(
  stockFood: number,
  demandPerTurn: number,
  minPerPop: number,
  maxPerPop: number,
): FoodStockpileBand {
  const demand = Math.max(1, demandPerTurn);
  const minThreshold = demand * minPerPop;
  const maxThreshold = demand * maxPerPop;
  if (stockFood < minThreshold) return "below";
  if (stockFood > maxThreshold) return "oversupply";
  return "acceptable";
}

/** Food emphasis % (0–100−R) that balances local production to demand at current research share. */
export function equilibriumFoodEmphasisPct(
  resourceRichness: number,
  emphasisResearch: number,
  opts?: {
    baseProductivity?: number;
    isHomeworld?: boolean;
    productionModifier?: number;
    recentDamagePopulation?: number;
    populationPeople?: number;
  },
): number {
  const baseProd =
    opts?.baseProductivity ?? defaultBaseProductivity(resourceRichness);
  const homeworldProdMult = opts?.isHomeworld ? HOMEWORLD_PROD_MULT : 1;
  const productionModifier = opts?.productionModifier ?? 1;
  const pop = opts?.populationPeople ?? 1_000_000;
  const damageProdMult = damagePenaltyMultiplier(
    pop,
    opts?.recentDamagePopulation ?? 0,
  );
  const denom = baseProd * FOOD_PROD_PER_POP * homeworldProdMult * productionModifier * damageProdMult;
  const wEq = denom > 0 ? FOOD_PER_POP / denom : 1 / 3;
  const wClamped = clamp(wEq, 0, 1);
  const maxFood = Math.max(0, 100 - emphasisResearch);
  return Math.min(maxFood, Math.max(0, 100 * wClamped));
}

export function equilibriumShipsPct(
  resourceRichness: number,
  emphasisResearch: number,
  opts?: {
    baseProductivity?: number;
    isHomeworld?: boolean;
    productionModifier?: number;
    recentDamagePopulation?: number;
    populationPeople?: number;
  },
): number {
  const foodEq = equilibriumFoodEmphasisPct(resourceRichness, emphasisResearch, opts);
  return Math.max(0, Math.min(100 - emphasisResearch, 100 - emphasisResearch - foodEq));
}
