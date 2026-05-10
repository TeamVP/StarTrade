import { query } from "../_generated/server";
import { v } from "convex/values";

export const getCommodityHistory = query({
  args: {
    gameId: v.id("sim_games"),
    commodity: v.string(),
    limit: v.number(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("eco_market_snapshots")
      .withIndex("by_gameId_and_commodity", (q) =>
        q.eq("gameId", args.gameId).eq("commodity", args.commodity),
      )
      .order("desc")
      .take(args.limit);
  },
});
