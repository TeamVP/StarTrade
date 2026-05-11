import { internalMutation } from "../_generated/server";
import { v } from "convex/values";
import {
  clampPopulationPeople,
  POPULATION_LEGACY_SCALE_CEILING,
  POPULATION_LEGACY_SCALE_MULTIPLIER,
  POPULATION_PEOPLE_PER_SIM_UNIT,
} from "../sim/economy/population";
import { FOOD_PER_POP } from "../sim/economy/constants";

/** Turns of food to guarantee each inhabited star starts with. */
const FOOD_BACKFILL_TURNS = 3;

/**
 * One-time data fix: scale legacy small-integer star populations to absolute headcount, seed
 * food stockpiles to at least 3 turns of demand, and refresh empire cached totals.
 * Safe to run multiple times — population scaling only touches rows still under
 * POPULATION_LEGACY_SCALE_CEILING; food is only raised (never reduced).
 *
 * Run: `npx convex run migrations/backfillLegacyPopulation:runLegacyPopulationScale`
 */
export const runLegacyPopulationScale = internalMutation({
  args: {},
  returns: v.object({
    systemsScanned: v.number(),
    systemsUpdated: v.number(),
    foodBackfilled: v.number(),
    empiresRecalculated: v.number(),
  }),
  handler: async (ctx) => {
    let systemsScanned = 0;
    let systemsUpdated = 0;
    let foodBackfilled = 0;

    const allSystems = await ctx.db.query("gal_systems").collect();

    for (const system of allSystems) {
      systemsScanned += 1;
      const raw = system.population ?? 0;

      const patch: {
        population?: number;
        recentDamagePopulation?: number;
        stockFood?: number;
      } = {};

      // --- population scale-up (legacy only) ---
      if (raw > 0 && raw < POPULATION_LEGACY_SCALE_CEILING) {
        const scaled = clampPopulationPeople(raw * POPULATION_LEGACY_SCALE_MULTIPLIER);
        patch.population = scaled;

        const dmg = system.recentDamagePopulation ?? 0;
        if (dmg > 0) {
          patch.recentDamagePopulation = clampPopulationPeople(
            dmg * POPULATION_LEGACY_SCALE_MULTIPLIER,
          );
        }
      }

      // --- food backfill: raise to at least FOOD_BACKFILL_TURNS of demand ---
      const finalPop =
        patch.population ?? (raw >= POPULATION_LEGACY_SCALE_CEILING ? raw : 0);
      if (finalPop > 0) {
        const simPop = finalPop / POPULATION_PEOPLE_PER_SIM_UNIT;
        const minFood = simPop * FOOD_PER_POP * FOOD_BACKFILL_TURNS;
        const currentFood = system.stockFood ?? 0;
        if (currentFood < minFood) {
          patch.stockFood = Math.ceil(minFood);
          foodBackfilled += 1;
        }
      }

      if (Object.keys(patch).length > 0) {
        await ctx.db.patch("gal_systems", system._id, patch);
        systemsUpdated += 1;
      }
    }

    // --- rebuild empire population + foodStockpile caches ---
    const empires = await ctx.db.query("emp_states").collect();
    let empiresRecalculated = 0;

    for (const emp of empires) {
      const owned = await ctx.db
        .query("gal_systems")
        .withIndex("by_gameId_and_ownerEmpireId", (q) =>
          q.eq("gameId", emp.gameId).eq("ownerEmpireId", emp._id),
        )
        .collect();

      const totalPop = owned.reduce((acc, s) => acc + (s.population ?? 0), 0);
      const totalFood = owned.reduce((acc, s) => acc + (s.stockFood ?? 0), 0);
      await ctx.db.patch("emp_states", emp._id, {
        population: totalPop,
        foodStockpile: totalFood,
      });
      empiresRecalculated += 1;
    }

    return {
      systemsScanned,
      systemsUpdated,
      foodBackfilled,
      empiresRecalculated,
    };
  },
});
