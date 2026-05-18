import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { resolveMissingGameMode } from "../sim/gameMode";
import {
  resolvePublisherContentReviewStatus,
  resolvePublisherContentStatus,
} from "../usr/publisherAccess";

export type MetadataBackfillArgs = {
  limit?: number;
  userCursor?: string | null;
  missionCursor?: string | null;
  strategyCursor?: string | null;
  gameCursor?: string | null;
};

export type MetadataBackfillResult = {
  limit: number;
  scannedUsers: number;
  scannedGames: number;
  scannedMissions: number;
  scannedStrategies: number;
  updatedUsers: number;
  updatedGames: number;
  updatedMissions: number;
  updatedStrategies: number;
  updatedUserIds: Id<"users">[];
  updatedGameIds: Id<"sim_games">[];
  updatedMissionIds: Id<"sim_missions">[];
  updatedStrategyIds: Id<"usr_automation_strategies">[];
  nextUserCursor: string | null;
  nextMissionCursor: string | null;
  nextStrategyCursor: string | null;
  nextGameCursor: string | null;
  sweepComplete: boolean;
};

export async function runMetadataBackfillBatch(
  ctx: MutationCtx,
  args: MetadataBackfillArgs,
): Promise<MetadataBackfillResult> {
  const limit = Math.max(1, Math.min(Math.floor(args.limit ?? 32), 128));
  let updatedUsers = 0;
  let updatedGames = 0;
  let updatedMissions = 0;
  let updatedStrategies = 0;
  let scannedUsers = 0;
  let scannedGames = 0;
  let scannedMissions = 0;
  let scannedStrategies = 0;

  const updatedUserIds: Id<"users">[] = [];
  const updatedGameIds: Id<"sim_games">[] = [];
  const updatedMissionIds: Id<"sim_missions">[] = [];
  const updatedStrategyIds: Id<"usr_automation_strategies">[] = [];

  const usersPage = await ctx.db.query("users").order("desc").paginate({
    cursor: args.userCursor ?? null,
    numItems: limit,
  });
  scannedUsers = usersPage.page.length;
  for (const user of usersPage.page) {
    const patch: {
      plan?: "free";
      publisher?: false;
    } = {};
    if (user.plan === undefined) {
      patch.plan = "free";
    }
    if (user.publisher === undefined) {
      patch.publisher = false;
    }
    if (Object.keys(patch).length === 0) {
      continue;
    }
    await ctx.db.patch("users", user._id, patch);
    updatedUsers += 1;
    updatedUserIds.push(user._id);
  }

  const missionsPage = await ctx.db.query("sim_missions").order("desc").paginate({
    cursor: args.missionCursor ?? null,
    numItems: limit,
  });
  scannedMissions = missionsPage.page.length;
  for (const mission of missionsPage.page) {
    const patch: {
      ownerUserId?: null;
      source?: "official";
      reviewStatus?: "unreviewed" | "needs_changes" | "approved";
      status?: "draft" | "published" | "archived" | "deleted" | "admin_deleted";
      mode?: "conquest_core" | "conquest_plus" | "trader_economy";
      requiredTier?: "free" | "pro";
    } = {};
    if (mission.ownerUserId === undefined) {
      patch.ownerUserId = null;
    }
    if (mission.source === undefined) {
      patch.source = "official";
    }
    if (mission.reviewStatus === undefined) {
      patch.reviewStatus = resolvePublisherContentReviewStatus({
        source: mission.source,
        reviewStatus: undefined,
      });
    }
    if (mission.status === undefined) {
      patch.status = resolvePublisherContentStatus({
        status: undefined,
        published: mission.published,
        defaultDraft: true,
      });
    }
    if (mission.mode === undefined) {
      patch.mode = "conquest_core";
    }
    if (mission.requiredTier === undefined) {
      patch.requiredTier = "free";
    }
    if (Object.keys(patch).length === 0) {
      continue;
    }
    await ctx.db.patch("sim_missions", mission._id, patch);
    updatedMissions += 1;
    updatedMissionIds.push(mission._id);
  }

  const strategiesPage = await ctx.db.query("usr_automation_strategies").order("desc").paginate({
    cursor: args.strategyCursor ?? null,
    numItems: limit,
  });
  scannedStrategies = strategiesPage.page.length;
  for (const strategy of strategiesPage.page) {
    const patch: {
      ownerUserId?: null;
      source?: "official";
      reviewStatus?: "unreviewed" | "needs_changes" | "approved";
      status?: "published";
    } = {};
    if (strategy.ownerUserId === undefined) {
      patch.ownerUserId = null;
    }
    if (strategy.source === undefined) {
      patch.source = "official";
    }
    if (strategy.reviewStatus === undefined) {
      patch.reviewStatus = resolvePublisherContentReviewStatus({
        source: strategy.source,
        reviewStatus: undefined,
      });
    }
    if (strategy.status === undefined) {
      patch.status = "published";
    }
    if (Object.keys(patch).length === 0) {
      continue;
    }
    await ctx.db.patch("usr_automation_strategies", strategy._id, patch);
    updatedStrategies += 1;
    updatedStrategyIds.push(strategy._id);
  }

  const gamesPage = await ctx.db.query("sim_games").order("desc").paginate({
    cursor: args.gameCursor ?? null,
    numItems: limit,
  });
  scannedGames = gamesPage.page.length;
  for (const game of gamesPage.page) {
    if (game.mode !== undefined) {
      continue;
    }
    const resolved = await resolveMissingGameMode(ctx, game);
    await ctx.db.patch("sim_games", game._id, { mode: resolved.mode });
    updatedGames += 1;
    updatedGameIds.push(game._id);
  }

  return {
    limit,
    scannedUsers,
    scannedGames,
    scannedMissions,
    scannedStrategies,
    updatedUsers,
    updatedGames,
    updatedMissions,
    updatedStrategies,
    updatedUserIds,
    updatedGameIds,
    updatedMissionIds,
    updatedStrategyIds,
    nextUserCursor: usersPage.isDone ? null : usersPage.continueCursor,
    nextMissionCursor: missionsPage.isDone ? null : missionsPage.continueCursor,
    nextStrategyCursor: strategiesPage.isDone ? null : strategiesPage.continueCursor,
    nextGameCursor: gamesPage.isDone ? null : gamesPage.continueCursor,
    sweepComplete: usersPage.isDone && missionsPage.isDone && strategiesPage.isDone && gamesPage.isDone,
  };
}