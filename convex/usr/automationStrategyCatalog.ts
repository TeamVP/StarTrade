import type { QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import type { PublicAutomationStrategy } from "./automationStrategyLibrary";
import { summarizeAutomationStrategy } from "./automationStrategyLibrary";
import {
  resolvePublisherContentSource,
  resolvePublisherContentStatus,
  type PublisherContentSource,
  type PublisherContentStatus,
} from "./publisherAccess";

export type AutomationStrategyRecord = Doc<"usr_automation_strategies">;

export type AutomationStrategyCatalogRow = PublicAutomationStrategy & {
  ownerUserId: Id<"users"> | null;
  source: PublisherContentSource;
  status: PublisherContentStatus;
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
    source: resolvePublisherContentSource(row.source),
    preview: summarizeAutomationStrategy(row.strategyJson),
  };
}

export function toAutomationStrategyCatalogRow(
  row: AutomationStrategyRecord,
): AutomationStrategyCatalogRow {
  return {
    ...toPublicAutomationStrategy(row),
    ownerUserId: row.ownerUserId ?? null,
    source: resolvePublisherContentSource(row.source),
    status: resolvePublisherContentStatus({ status: row.status }),
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
  if (
    strategy === null ||
    !strategy.availableForHumans ||
    resolvePublisherContentStatus({ status: strategy.status }) !== "published"
  ) {
    return null;
  }
  return toPublicAutomationStrategy(strategy);
}
