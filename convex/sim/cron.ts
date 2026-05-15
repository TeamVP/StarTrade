import { internalMutation } from "../_generated/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import { evaluateGameFinalization } from "./finalization";

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
      if (game.simCronTurnsDisabled === true) {
        continue;
      }
      if (game.turnPausedUntilMs !== undefined && now < game.turnPausedUntilMs) {
        continue;
      }

      try {
        const begin: {
          started: boolean;
          turnNumber: number;
          alreadyResolving: boolean;
        } = await ctx.runMutation(internal.sim.internal.beginTurnResolution, {
          gameId: game._id,
        });
        if (!begin.started) {
          continue;
        }
        await ctx.scheduler.runAfter(0, internal.sim.actions.resolveTurnJob, {
          gameId: game._id,
          turnNumber: begin.turnNumber,
        });
        stepped += 1;
      } catch (error) {
        console.error(
          "tickRunningGames: skipped game after error",
          game._id,
          error,
        );
      }
    }

    return { stepped };
  },
});

/** Periodic lifecycle sweep: score abandoned games and finish any game awaiting results. */
export const sweepInactiveGames = internalMutation({
  args: v.object({}),
  handler: async (ctx): Promise<{ checked: number; finalized: number }> => {
    let checked = 0;
    let finalized = 0;

    for (const status of ["running", "paused"] as const) {
      const games = await ctx.db
        .query("sim_games")
        .withIndex("by_status", (q) => q.eq("status", status))
        .take(32);
      for (const game of games) {
        checked += 1;
        const result = await evaluateGameFinalization(ctx, { gameId: game._id });
        if (result.finalized) {
          finalized += 1;
        }
      }
    }

    const pendingResults = await ctx.db
      .query("sim_games")
      .withIndex("by_finalizationState", (q) => q.eq("finalizationState", "pending_result_write"))
      .take(32);
    for (const game of pendingResults) {
      checked += 1;
      const result = await evaluateGameFinalization(ctx, { gameId: game._id });
      if (result.finalized) {
        finalized += 1;
      }
    }

    return { checked, finalized };
  },
});
