import { query } from "../_generated/server";
import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";

export const listTraderCharters = query({
  args: {
    gameId: v.id("sim_games"),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      return [];
    }

    return await ctx.db
      .query("trd_charters")
      .withIndex("by_gameId_and_traderUserId", (q) =>
        q.eq("gameId", args.gameId).eq("traderUserId", userId),
      )
      .take(256);
  },
});
