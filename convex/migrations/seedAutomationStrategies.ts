import { internalMutation } from "../_generated/server";
import { v } from "convex/values";
import { BUILT_IN_AUTOMATION_STRATEGY_SEED_ROWS } from "../usr/automationStrategyLibrary";
import { getAutomationStrategyByKey } from "../usr/automationStrategyCatalog";

export const seedBuiltInAutomationStrategies = internalMutation({
  args: {},
  returns: v.object({
    inserted: v.number(),
    skipped: v.number(),
  }),
  handler: async (ctx) => {
    let inserted = 0;
    let skipped = 0;

    for (const strategy of BUILT_IN_AUTOMATION_STRATEGY_SEED_ROWS) {
      const existing = await getAutomationStrategyByKey(ctx, strategy.key);
      if (existing !== null) {
        skipped += 1;
        continue;
      }

      const now = Date.now();
      await ctx.db.insert("usr_automation_strategies", {
        key: strategy.key,
        name: strategy.name,
        description: strategy.description,
        tags: strategy.tags,
        strategyJson: strategy.strategyJson,
        availableForHumans: strategy.availableForHumans,
        availableForNpcs: strategy.availableForNpcs,
        createdAt: now,
        updatedAt: now,
      });
      inserted += 1;
    }

    return { inserted, skipped };
  },
});
