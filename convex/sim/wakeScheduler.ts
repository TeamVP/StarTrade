import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import {
  msUntilTurnBoundary,
  msUntilTurnPreparationStart,
  scheduledNextTurnStartedAt,
  scheduledTurnPreparationAt,
} from "./turnTiming";

export async function scheduleGameTurnWakeups(
  ctx: MutationCtx,
  params: {
    gameId: Id<"sim_games">;
    turnStartedAtMs: number;
    turnDurationMs: number;
    nowMs: number;
  },
): Promise<{ generation: number; nextPreparationWakeAt: number; nextBoundaryWakeAt: number }> {
  const game = await ctx.db.get("sim_games", params.gameId);
  if (game === null) {
    throw new Error("scheduleGameTurnWakeups: game not found.");
  }

  const generation = (game.schedulerGeneration ?? 0) + 1;
  const nextPreparationWakeAt = scheduledTurnPreparationAt({
    turnStartedAtMs: params.turnStartedAtMs,
    turnDurationMs: params.turnDurationMs,
  });
  const nextBoundaryWakeAt = scheduledNextTurnStartedAt({
    turnStartedAtMs: params.turnStartedAtMs,
    turnDurationMs: params.turnDurationMs,
  });

  await ctx.db.patch("sim_games", params.gameId, {
    schedulerGeneration: generation,
    nextPreparationWakeAt,
    nextBoundaryWakeAt,
    lastWakeScheduledAt: params.nowMs,
  });

  await ctx.scheduler.runAfter(
    msUntilTurnPreparationStart({
      nowMs: params.nowMs,
      turnStartedAtMs: params.turnStartedAtMs,
      turnDurationMs: params.turnDurationMs,
    }),
    internal.sim.actions.attemptGameWake,
    { gameId: params.gameId, generation, wakeKind: "prepare" },
  );

  await ctx.scheduler.runAfter(
    msUntilTurnBoundary({
      nowMs: params.nowMs,
      turnStartedAtMs: params.turnStartedAtMs,
      turnDurationMs: params.turnDurationMs,
    }),
    internal.sim.actions.attemptGameWake,
    { gameId: params.gameId, generation, wakeKind: "boundary" },
  );

  return { generation, nextPreparationWakeAt, nextBoundaryWakeAt };
}