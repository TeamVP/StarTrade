/** Tuning aligned with docs/2026_May--StarTrade_system_spec.md §8–13, §18. */

/**
 * Food demand per "sim population unit" per turn (sim units ≈ 1 M people).
 * e.g. 50 sim-pop → 500 food-units demanded per turn.
 * Scaled ×10 vs initial calibration so stockpiles are visibly large numbers
 * and per-turn flows are clearly non-zero even for small colonies.
 */
export const FOOD_PER_POP = 10;

/**
 * Food produced per (simPop × baseProd × w.food) per turn.
 * Calibrated so a default-emphasis (34 % food) system with baseProd ≈ 5 sits at equilibrium:
 *   baseProd=5, w.food≈0.34 → 5 × 0.34 × 5.88 ≈ 10.0 (= FOOD_PER_POP ✓).
 * Richer stars (higher baseProd) produce surplus with default sliders;
 * poorer stars need the ships slider moved leftward to feed their population.
 *
 * Equilibrium food weight: w_eq = FOOD_PER_POP / (baseProd × FOOD_PROD_PER_POP × prodModifier)
 */
export const FOOD_PROD_PER_POP = 5.88;

/**
 * At {@link FOOD_EMPHASIS_REFERENCE_SHARE} food emphasis or higher, local food output is floored to at least
 * this fraction of one turn's demand. Below that emphasis share, the floor scales down linearly to zero.
 */
export const FOOD_PROD_MIN_FLOOR_FRACTION = 0.5;

/** Normalized food weight (~34% food in default 34/33/33) at which the full subsistence floor applies. */
export const FOOD_EMPHASIS_REFERENCE_SHARE = 1 / 3;

/**
 * Fraction of food-shortfall (in sim-pop units) converted to population loss per turn.
 * At full starvation (shortfall = full demand) with 50 M pop: ≈ 10 % of population dies per turn.
 * Scaled ×0.1 vs initial value because food quantities are ×10, keeping the same effective
 * starvation rate per-capita.
 * Loss = ceil(shortfall × STARVATION_FACTOR × POPULATION_PEOPLE_PER_SIM_UNIT) people.
 */
export const STARVATION_FACTOR = 0.01;
export const POP_GROWTH_RATE = 0.01;
/** Default empire tax rate (fraction); at this rate, treasury pop-tax matches pre-policy baseline. */
export const DEFAULT_EMPIRE_TAX_RATE = 0.05;
/** Maximum empire tax rate (fraction). */
export const MAX_EMPIRE_TAX_RATE = 0.3;

/** Treasury income per sim population unit per taxable turn (units ≈ millions of people). */
export const TAX_PER_POP = 0.2;

/** Empire treasury upkeep per sim population unit (aggregate headcount / PEOPLE_PER_SIM_UNIT). */
export const EMPIRE_UPKEEP_PER_SIM_POP = 0.05;
export const HOMEWORLD_TAX_MULT = 1.25;
export const HOMEWORLD_PROD_MULT = 1.5;
export const WEAPONS_CONSUMPTION_RATE = 0.25;
export const MAX_WEAPONS_BONUS = 0.25;
export const SHORTAGE_THRESHOLD_RATIO = 0.5;
export const SHORTAGE_PROD_MULT = 0.85;
export const COLLAPSE_INSOLVENCY_TURNS = 2;
export const PAUSE_BUDGET_CAP_SECONDS = 20;
export const PAUSE_BUDGET_REFRESH_MS = 300_000;
/** Local treasury assigned to every star system when a game is seeded. */
export const STAR_SYSTEM_STARTING_TREASURY = 10_000;

export const COMMODITY_PRICE_DEFAULTS = {
  food: { basePrice: 10, elasticity: 0.8, minMult: 0.5, maxMult: 3 },
  weapons: { basePrice: 20, elasticity: 0.9, minMult: 0.6, maxMult: 3.5 },
  heavy_metals: { basePrice: 14, elasticity: 0.6, minMult: 0.6, maxMult: 2.5 },
} as const;

/** Scaled ×10 alongside FOOD_PER_POP so the aggregate pressure formula keeps the same shape. */
export const FOOD_DEMAND_BUFFER = 500;

// ─── Per-system food price ─────────────────────────────────────────────────
/**
 * Base food price per unit in credits at equilibrium (stockFood ≈ one turn of demand).
 * Low when stockFood >> demand (surplus → oversupply pushes price down).
 * High when stockFood << demand (shortage → scarcity pushes price up).
 */
export const FOOD_PRICE_BASE = 10;
/** How strongly the local supply/demand ratio moves price. Higher = wider swings. */
export const FOOD_PRICE_ELASTICITY = 2.0;
/** Minimum multiplier (rock-bottom surplus: ~3 credits). */
export const FOOD_PRICE_MIN_MULT = 0.3;
/** Maximum multiplier (severe shortage: ~50 credits). */
export const FOOD_PRICE_MAX_MULT = 5.0;

// ─── Background NPC traders ────────────────────────────────────────────────
/**
 * Food units loaded per trader voyage.
 * Scaled ×10 alongside FOOD_PER_POP so one delivery covers ~2 turns of demand for a 50 M-pop world,
 * which keeps trade routes meaningful without requiring fleets of ships.
 */
/** Max food units per NPC voyage; actual load is min(this, origin oversupply above stockpile cap). */
export const BG_TRADER_CARGO_SIZE = 1000;
/**
 * Credits per turn while the trader's hired ship is in transit.
 */
export const BG_TRADER_SHIP_HIRE_PER_TURN = 250;
/** One-time docking fee paid when the trader's ship arrives at the destination. */
export const BG_TRADER_DOCKING_COST = 100;
/**
 * Profit-margin multiplier required above per-unit transport cost before deploying.
 * 0.2 = 20 % margin required, so traders only go when the spread is meaningfully above costs.
 *
 * @deprecated NPC routing now uses {@link BG_TRADER_MIN_REVENUE_TO_COST_RATIO} on full voyage economics.
 */
export const BG_TRADER_MIN_PROFIT_MARGIN = 0.2;

/** Minimum expected revenue ÷ full cost (purchase + ship + docking) for any trader voyage. */
export const BG_TRADER_MIN_REVENUE_TO_COST_RATIO = 1.6;
/** Below this ratio (but still ≥ minimum), admin spawn succeeds with a profitability warning. */
export const BG_TRADER_WARN_REVENUE_TO_COST_RATIO = 2.2;
/** Upper bound for admin / manual max NPC traders (keeps load bounded). */
export const BG_TRADER_MAX_ACTIVE = 16;
/** Default max active NPC traders for new games and automated baseline. */
export const BG_TRADER_AUTOMATED_INITIAL_MAX_ACTIVE = 3;
/**
 * When Σ delivery revenue ÷ Σ delivery cost exceeds this over a review window,
 * automated max NPC traders increases by 1 (capped by the NPC catalog size).
 */
export const BG_TRADER_AUTOMATION_INCREASE_EARNINGS_TO_COST_RATIO = 1.4;
/**
 * Minimum NPC-attributed finished voyages in the 10-turn window before adjusting limits
 * (avoids noisy swings when traffic is thin).
 */
export const BG_TRADER_AUTOMATION_MIN_NPC_DELIVERIES_IN_WINDOW = 3;
/** Maximum new traders that can depart from a single system in one turn. */
export const BG_TRADER_MAX_DEPARTURES_PER_SYSTEM = 1;
/** Maximum new traders spawned across the whole game per turn. */
export const BG_TRADER_MAX_NEW_PER_TURN = 3;
/** Default percent chance that an NPC accepts a viable trade job and hires a ship. */
export const BG_TRADER_HIRE_CHANCE_PCT = 20;

// ─── Named NPC trader identities (per-game treasury & bankruptcy) ─────────
/** Credits granted when an inactive NPC is activated into the roster. */
export const NPC_TRADER_STARTING_TREASURY = 10_000;
/** If treasury drops strictly below this, the NPC is marked bankrupt for that game. */
export const NPC_TRADER_BANKRUPTCY_BELOW = 1000;
