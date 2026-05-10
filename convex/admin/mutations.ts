import { mutation } from "../_generated/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";

export const reseedGame = mutation({
  args: {
    gameId: v.id("sim_games"),
    mapKey: v.string(),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ systems: number; empires: number; mapKey: string }> => {
    const result: { systems: number; empires: number; mapKey: string } =
      await ctx.runMutation(internal.admin.internal.seedGameData, args);
    return result;
  },
});
