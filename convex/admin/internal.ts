import { internalMutation } from "../_generated/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import { seedLegacyV1Core } from "../seed/v1CoreSeed";
import { seedV1MediumMap } from "../seed/v1MediumSeed";
import { seedV1TwentyMap } from "../seed/v1TwentySeed";
import { loadEmpireColorPrefLookup } from "../seed/empireColorPrefLookup";
import { wipeGamePhaseBatch, wipePhaseAtIndex } from "../sim/wipeGame";

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

    const game = await ctx.db.get("sim_games", args.gameId);
    if (game === null) {
      throw new Error("Game not found.");
    }
    const npcEmpireKeys = game.npcEmpireKeys ?? [];

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
      );
    }

    if (args.mapKey === "v1-spiral") {
      await ctx.scheduler.runAfter(0, internal.seed.spiralSeedAction.runFullSpiralSeed, {
        gameId: args.gameId,
        colorPrefsUserId: args.colorPrefsUserId,
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
