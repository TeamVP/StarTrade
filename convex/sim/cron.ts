import { internalMutation } from "../_generated/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import { evaluateGameFinalization } from "./finalization";
import { turnDurationHasElapsed } from "./turnTiming";

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
        const commit = await ctx.runMutation(internal.sim.internal.commitPreparedTurn, {
          gameId: game._id,
          turnNumber: game.currentTurn,
        });
        if (commit.committed) {
          stepped += 1;
          continue;
        }
        const begin: {
          started: boolean;
          turnNumber: number;
          alreadyResolving: boolean;
        } = await ctx.runMutation(internal.sim.internal.beginTurnResolution, {
          gameId: game._id,
        });
        if (!begin.started) {
          const turnRow = await ctx.db
            .query("sim_turns")
            .withIndex("by_gameId_and_turnNumber", (q) =>
              q.eq("gameId", game._id).eq("turnNumber", game.currentTurn),
            )
            .unique();
          const preparationRow = await ctx.db
            .query("sim_turn_preparations")
            .withIndex("by_gameId_and_turnNumber", (q) =>
              q.eq("gameId", game._id).eq("turnNumber", game.currentTurn),
            )
            .unique();
          const stalePreparedTurn =
            turnRow !== null &&
            (turnRow.state === "prepared" || preparationRow?.state === "prepared") &&
            turnDurationHasElapsed({
              nowMs: now,
              turnStartedAtMs: turnRow.startedAt,
              turnDurationMs: game.turnDurationMs,
            });
          if (stalePreparedTurn) {
            await ctx.runMutation(internal.sim.internal.resetCurrentTurnPreparationForRecovery, {
              gameId: game._id,
            });
            const retried: {
              started: boolean;
              turnNumber: number;
              alreadyResolving: boolean;
            } = await ctx.runMutation(internal.sim.internal.beginTurnResolution, {
              gameId: game._id,
            });
            if (retried.started) {
              await ctx.scheduler.runAfter(0, internal.sim.actions.resolveTurnJob, {
                gameId: game._id,
                turnNumber: retried.turnNumber,
              });
              stepped += 1;
              continue;
            }
          }
        }
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

    const finishedGames = await ctx.db
      .query("sim_games")
      .withIndex("by_status", (q) => q.eq("status", "finished"))
      .take(32);
    for (const game of finishedGames) {
      if (
        game.finalizationState === "pending_cleanup" ||
        game.finalizationState === "cleaned" ||
        game.finalizationState === "archived_debug"
      ) {
        continue;
      }
      checked += 1;
      const result = await evaluateGameFinalization(ctx, { gameId: game._id });
      if (result.finalized) {
        finalized += 1;
      }
    }

    return { checked, finalized };
  },
});
