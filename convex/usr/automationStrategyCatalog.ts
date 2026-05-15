import type { QueryCtx } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";
import type { PublicAutomationStrategy } from "./automationStrategyLibrary";
import { summarizeAutomationStrategy } from "./automationStrategyLibrary";

export type AutomationStrategyRecord = Doc<"usr_automation_strategies">;

export type AutomationStrategyCatalogRow = PublicAutomationStrategy & {
  availableForHumans: boolean;
  availableForNpcs: boolean;
  createdAt: number;
  updatedAt: number;
};

type DbCtx = { db: QueryCtx["db"] };

export function toPublicAutomationStrategy(row: AutomationStrategyRecord): PublicAutomationStrategy {
  return {
    key: row.key,
    name: row.name,
    description: row.description,
    tags: row.tags,
    strategyJson: row.strategyJson,
    preview: summarizeAutomationStrategy(row.strategyJson),
  };
}

export function toAutomationStrategyCatalogRow(
  row: AutomationStrategyRecord,
): AutomationStrategyCatalogRow {
  return {
    ...toPublicAutomationStrategy(row),
    availableForHumans: row.availableForHumans,
    availableForNpcs: row.availableForNpcs,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function getAutomationStrategyByKey(
  ctx: DbCtx,
  key: string,
): Promise<AutomationStrategyRecord | null> {
  return await ctx.db
    .query("usr_automation_strategies")
    .withIndex("by_key", (q) => q.eq("key", key))
    .unique();
}

export async function getPublicAutomationStrategyByKey(
  ctx: DbCtx,
  key: string,
): Promise<PublicAutomationStrategy | null> {
  const strategy = await getAutomationStrategyByKey(ctx, key);
  if (strategy === null || !strategy.availableForHumans) {
    return null;
  }
  return toPublicAutomationStrategy(strategy);
}
