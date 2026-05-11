import { query } from "../_generated/server";
import { v } from "convex/values";

export const listActiveBattles = query({
  args: { gameId: v.id("sim_games"), limit: v.number() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("cmb_battles")
      .withIndex("by_gameId_and_status", (q) =>
        q.eq("gameId", args.gameId).eq("status", "active"),
      )
      .take(args.limit);
  },
});
