import { query } from "../_generated/server";
import { v } from "convex/values";

export const listFleetsForGame = query({
  args: { gameId: v.id("sim_games"), limit: v.number() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("flt_fleets")
      .withIndex("by_gameId", (q) => q.eq("gameId", args.gameId))
      .take(args.limit);
  },
});
