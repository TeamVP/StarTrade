import { internalMutation } from "../_generated/server";
import { v } from "convex/values";

export const recordMarketSnapshot = internalMutation({
  args: {
    gameId: v.id("sim_games"),
    turnNumber: v.number(),
    commodity: v.string(),
    unitPrice: v.number(),
    volume: v.number(),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("eco_market_snapshots", args);
  },
});
