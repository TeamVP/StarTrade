import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { mutation } from "../_generated/server";
import { assertGameAdmin } from "../sim/helpers";
import { evaluateGameFinalization } from "../sim/finalization";

export const finalizeGameByScore = mutation({
  args: { gameId: v.id("sim_games") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      throw new Error("Authentication required.");
    }
    await assertGameAdmin(ctx, args.gameId, userId);

    const game = await ctx.db.get("sim_games", args.gameId);
    if (game === null) {
      throw new Error("Game not found.");
    }

    return await evaluateGameFinalization(ctx, {
      gameId: args.gameId,
      forceFinishReason: "admin_terminated_scored",
    });
  },
});

export const setGameRetentionClass = mutation({
  args: {
    gameId: v.id("sim_games"),
    retentionClass: v.union(
      v.literal("discarded"),
      v.literal("official"),
      v.literal("archived_debug"),
    ),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      throw new Error("Authentication required.");
    }
    await assertGameAdmin(ctx, args.gameId, userId);

    const game = await ctx.db.get("sim_games", args.gameId);
    if (game === null) {
      throw new Error("Game not found.");
    }
    if (game.finalizationState === "pending_cleanup" || game.finalizationState === "cleaned") {
      throw new Error("Cannot change retention after cleanup has started.");
    }

    await ctx.db.patch("sim_games", args.gameId, {
      retentionClass: args.retentionClass,
      finalizationState:
        game.finalizationState === undefined ? "none" : game.finalizationState,
    });

    return { retentionClass: args.retentionClass };
  },
});