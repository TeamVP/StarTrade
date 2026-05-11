/** Stored population values are absolute headcount (people). Max ~100B per star. */

export const POPULATION_PEOPLE_STAR_MAX = 100_000_000_000;

/** Below this after resolution the colony is abandoned (population cleared, owner removed). */
export const POPULATION_MIN_INHABITED_PEOPLE = 1000;

/**
 * Economy formulas historically used ~100 as “planet scale”. One economy unit =
 * this many people so demand/tax stay in a similar numeric range while DB holds real headcounts.
 */
export const POPULATION_PEOPLE_PER_SIM_UNIT = 1_000_000;

/**
 * Old saves stored population as small integers (e.g. 100 ≈ homeworld). Multiply once into real
 * headcount: 100 × this = 50_000_000 people. Only rows still under {@link POPULATION_LEGACY_SCALE_CEILING}
 * are migrated so already-upgraded games are idempotent.
 */
export const POPULATION_LEGACY_SCALE_MULTIPLIER = 500_000;

/** Headcount at or above this is treated as already in “people” units (migration skips). */
export const POPULATION_LEGACY_SCALE_CEILING = 1_000_000;

export function clampPopulationPeople(n: number): number {
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(Math.floor(n), POPULATION_PEOPLE_STAR_MAX);
}

/** Continuous “planet population” scalar for food/tax/weapons math (≈ millions of people). */
export function populationToSimUnits(people: number): number {
  return Math.max(0, people) / POPULATION_PEOPLE_PER_SIM_UNIT;
}
