import { internalMutation } from "../_generated/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";

/** Advances every running game whose pause window has expired (spec §6 cron driver). */
export const tickRunningGames = internalMutation({
  args: v.object({}),
  handler: async (ctx): Promise<{ stepped: number }> => {
    const games = await ctx.db
      .query("sim_games")
      .withIndex("by_status", (q) => q.eq("status", "running"))
      .take(32);

    const now = Date.now();
    let stepped = 0;

    for (const game of games) {
      if (game.turnPausedUntilMs !== undefined && now < game.turnPausedUntilMs) {
        continue;
      }

      await ctx.runMutation(internal.sim.internal.resolveTurn, {
        gameId: game._id,
      });
      stepped += 1;
    }

    return { stepped };
  },
});
