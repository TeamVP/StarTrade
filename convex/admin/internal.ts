import { internalMutation } from "../_generated/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import { seedLegacyV1Core } from "../seed/v1CoreSeed";
import { seedV1MediumMap } from "../seed/v1MediumSeed";
import { seedV1TwentyMap } from "../seed/v1TwentySeed";
import { loadEmpireColorPrefLookup } from "../seed/empireColorPrefLookup";
import { gameUsesTraderEconomy, loadGameWithPersistedResolvedMode } from "../sim/gameMode";
import { wipeGamePhaseBatch, wipePhaseAtIndex } from "../sim/wipeGame";
import { runMetadataBackfillBatch } from "./metadataBackfill";

const METADATA_BACKFILL_STATE_KEY = "default";
const METADATA_BACKFILL_MAX_PASSES = 4;

export const seedGameData = internalMutation({
  args: {
    gameId: v.id("sim_games"),
    mapKey: v.string(),
    /** When set, this user’s catalog color overrides apply to scripted empires and NPC personas. */
    colorPrefsUserId: v.optional(v.id("users")),
  },
  handler: async (ctx, args) => {
    const empiresAlready = await ctx.db
      .query("emp_states")
      .withIndex("by_gameId", (q) => q.eq("gameId", args.gameId))
      .take(1);

    if (empiresAlready.length > 0) {
      throw new Error("Game is already seeded.");
    }

    const systemsPeek = await ctx.db
      .query("gal_systems")
      .withIndex("by_gameId", (q) => q.eq("gameId", args.gameId))
      .take(1);

    if (args.mapKey !== "v1-spiral" && systemsPeek.length > 0) {
      throw new Error("Game is already seeded.");
    }

    const game = await loadGameWithPersistedResolvedMode(ctx, args.gameId);
    if (game === null) {
      throw new Error("Game not found.");
    }
    const npcEmpireKeys = game.npcEmpireKeys ?? [];
    const seedTraderIdentities = gameUsesTraderEconomy(game);

    const empireColorPrefLookup = await loadEmpireColorPrefLookup(
      ctx,
      args.colorPrefsUserId ?? null,
    );

    if (args.mapKey === "v1-twenty") {
      return await seedV1TwentyMap(
        ctx,
        args.gameId,
        args.mapKey,
        game.seed,
        npcEmpireKeys,
        empireColorPrefLookup,
        seedTraderIdentities,
      );
    }

    if (args.mapKey === "v1-medium") {
      return await seedV1MediumMap(
        ctx,
        args.gameId,
        args.mapKey,
        game.seed,
        npcEmpireKeys,
        empireColorPrefLookup,
        seedTraderIdentities,
      );
    }

    if (args.mapKey === "v1-spiral") {
      await ctx.scheduler.runAfter(0, internal.seed.spiralSeedAction.runFullSpiralSeed, {
        gameId: args.gameId,
        colorPrefsUserId: args.colorPrefsUserId,
        seedTraders: seedTraderIdentities,
      });
      return { systems: 200, empires: 0, mapKey: args.mapKey };
    }

    const mapScale = args.mapKey === "v1-large" ? 2 : 1;
    return await seedLegacyV1Core(
      ctx,
      args.gameId,
      mapScale,
      args.mapKey,
      empireColorPrefLookup,
      seedTraderIdentities,
    );
  },
});

/**
 * Deletes game-scoped rows in small batches. Scheduled repeatedly from {@link admin/mutations.killGame}
 * so no single mutation exceeds Convex read limits.
 */
export const continueWipeGame = internalMutation({
  args: {
    gameId: v.id("sim_games"),
    phaseIndex: v.number(),
  },
  handler: async (ctx, args): Promise<{ complete: boolean }> => {
    const phase = wipePhaseAtIndex(args.phaseIndex);
    if (phase === null) {
      const game = await ctx.db.get("sim_games", args.gameId);
      if (game !== null) {
        if (game.retentionClass === "discarded") {
          await ctx.db.delete("sim_games", args.gameId);
        } else {
          await ctx.db.patch("sim_games", args.gameId, {
            finalizationState: game.retentionClass === "archived_debug" ? "archived_debug" : "cleaned",
            cleanupCompletedAt: Date.now(),
          });
        }
      }
      return { complete: true };
    }

    const result = await wipeGamePhaseBatch(ctx, args.gameId, phase);
    if (result === "more") {
      await ctx.scheduler.runAfter(0, internal.admin.internal.continueWipeGame, {
        gameId: args.gameId,
        phaseIndex: args.phaseIndex,
      });
    } else {
      await ctx.scheduler.runAfter(0, internal.admin.internal.continueWipeGame, {
        gameId: args.gameId,
        phaseIndex: args.phaseIndex + 1,
      });
    }
    return { complete: false };
  },
});

export const runMetadataBackfillSweep = internalMutation({
  args: {
    limit: v.optional(v.number()),
    maxPasses: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const existingState = await ctx.db
      .query("admin_metadata_backfill_state")
      .withIndex("by_key", (q) => q.eq("key", METADATA_BACKFILL_STATE_KEY))
      .unique();

    const limit = args.limit ?? 32;
    const maxPasses = Math.max(1, Math.min(Math.floor(args.maxPasses ?? METADATA_BACKFILL_MAX_PASSES), 16));
    let result = await runMetadataBackfillBatch(ctx, {
      limit,
      userCursor: existingState?.userCursor ?? null,
      missionCursor: existingState?.missionCursor ?? null,
      strategyCursor: existingState?.strategyCursor ?? null,
      gameCursor: existingState?.gameCursor ?? null,
    });

    let passesRun = 1;
    while (!result.sweepComplete && passesRun < maxPasses) {
      const nextPass = await runMetadataBackfillBatch(ctx, {
        limit,
        userCursor: result.nextUserCursor,
        missionCursor: result.nextMissionCursor,
        strategyCursor: result.nextStrategyCursor,
        gameCursor: result.nextGameCursor,
      });
      result = {
        limit: nextPass.limit,
        scannedUsers: result.scannedUsers + nextPass.scannedUsers,
        scannedGames: result.scannedGames + nextPass.scannedGames,
        scannedMissions: result.scannedMissions + nextPass.scannedMissions,
        scannedStrategies: result.scannedStrategies + nextPass.scannedStrategies,
        updatedUsers: result.updatedUsers + nextPass.updatedUsers,
        updatedGames: result.updatedGames + nextPass.updatedGames,
        updatedMissions: result.updatedMissions + nextPass.updatedMissions,
        updatedStrategies: result.updatedStrategies + nextPass.updatedStrategies,
        updatedUserIds: [...result.updatedUserIds, ...nextPass.updatedUserIds],
        updatedGameIds: [...result.updatedGameIds, ...nextPass.updatedGameIds],
        updatedMissionIds: [...result.updatedMissionIds, ...nextPass.updatedMissionIds],
        updatedStrategyIds: [...result.updatedStrategyIds, ...nextPass.updatedStrategyIds],
        nextUserCursor: nextPass.nextUserCursor,
        nextMissionCursor: nextPass.nextMissionCursor,
        nextStrategyCursor: nextPass.nextStrategyCursor,
        nextGameCursor: nextPass.nextGameCursor,
        sweepComplete: nextPass.sweepComplete,
      };
      passesRun += 1;
    }

    const updatedRows =
      result.updatedUsers + result.updatedGames + result.updatedMissions + result.updatedStrategies;
    const now = Date.now();
    const nextState = {
      userCursor: result.nextUserCursor,
      missionCursor: result.nextMissionCursor,
      strategyCursor: result.nextStrategyCursor,
      gameCursor: result.nextGameCursor,
      lastRunAt: now,
      lastSweepCompletedAt: result.sweepComplete ? now : (existingState?.lastSweepCompletedAt ?? undefined),
      lastUpdatedRows: updatedRows,
    };

    if (existingState === null) {
      await ctx.db.insert("admin_metadata_backfill_state", {
        key: METADATA_BACKFILL_STATE_KEY,
        ...nextState,
      });
    } else {
      await ctx.db.replace("admin_metadata_backfill_state", existingState._id, {
        key: METADATA_BACKFILL_STATE_KEY,
        ...nextState,
      });
    }

    return result;
  },
});
