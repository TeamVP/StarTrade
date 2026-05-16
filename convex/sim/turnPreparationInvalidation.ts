import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

async function deletePreparationOperations(
  ctx: MutationCtx,
  preparationId: Id<"sim_turn_preparations">,
): Promise<void> {
  while (true) {
    const batch = await ctx.db
      .query("sim_turn_preparation_ops")
      .withIndex("by_preparationId_and_opOrder", (q) => q.eq("preparationId", preparationId))
      .take(256);
    if (batch.length === 0) {
      break;
    }
    for (const row of batch) {
      await ctx.db.delete("sim_turn_preparation_ops", row._id);
    }
  }
}

export async function invalidateOpenTurnPreparation(
  ctx: MutationCtx,
  gameId: Id<"sim_games">,
): Promise<void> {
  const game = await ctx.db.get("sim_games", gameId);
  if (game === null) {
    return;
  }

  const turn = await ctx.db
    .query("sim_turns")
    .withIndex("by_gameId_and_turnNumber", (q) =>
      q.eq("gameId", gameId).eq("turnNumber", game.currentTurn),
    )
    .unique();
  if (turn === null || turn.state !== "open") {
    return;
  }

  const preparation = await ctx.db
    .query("sim_turn_preparations")
    .withIndex("by_gameId_and_turnNumber", (q) =>
      q.eq("gameId", gameId).eq("turnNumber", game.currentTurn),
    )
    .unique();

  await ctx.db.patch("sim_turns", turn._id, {
    preparedAt: undefined,
    resolvingStartedAt: undefined,
    resolutionPhase: undefined,
  });

  if (preparation === null) {
    return;
  }

  await deletePreparationOperations(ctx, preparation._id);
  await ctx.db.patch("sim_turn_preparations", preparation._id, {
    state: "queued",
    requestedAt: Date.now(),
    startedAt: undefined,
    preparedAt: undefined,
    committedAt: undefined,
    resolutionPhase: undefined,
    summaryJson: undefined,
  });
}
