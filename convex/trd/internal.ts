import { internalMutation } from "../_generated/server";
import { v } from "convex/values";

export const recordTradeRun = internalMutation({
  args: {
    gameId: v.id("sim_games"),
    charterId: v.id("trd_charters"),
    traderIdentityId: v.id("sim_trader_identities"),
    turnNumber: v.number(),
    commodity: v.string(),
    unitsMoved: v.number(),
    payout: v.number(),
    success: v.boolean(),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("trd_runs", args);
  },
});
