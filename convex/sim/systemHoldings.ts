import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

export async function resolveGameActorIdForEmpire(
  ctx: MutationCtx,
  params: {
    gameId: Id<"sim_games">;
    empireId: Id<"emp_states">;
  },
): Promise<Id<"sim_game_actors"> | null> {
  const actor = await ctx.db
    .query("sim_game_actors")
    .withIndex("by_gameId_and_legacyEmpireId", (q) =>
      q.eq("gameId", params.gameId).eq("legacyEmpireId", params.empireId),
    )
    .unique();
  return actor?._id ?? null;
}

async function resolveWinnerGameActorId(
  ctx: MutationCtx,
  params: {
    gameId: Id<"sim_games">;
    winnerEmpireId: Id<"emp_states">;
    winnerGameActorId?: Id<"sim_game_actors">;
  },
): Promise<Id<"sim_game_actors"> | null> {
  if (params.winnerGameActorId !== undefined) {
    const actor = await ctx.db.get("sim_game_actors", params.winnerGameActorId);
    if (actor === null || actor.gameId !== params.gameId) {
      throw new Error("Winning game actor not found.");
    }
    if (actor.legacyEmpireId !== params.winnerEmpireId) {
      throw new Error("Winning game actor does not match the winning empire.");
    }
    return actor._id;
  }

  return await resolveGameActorIdForEmpire(ctx, {
    gameId: params.gameId,
    empireId: params.winnerEmpireId,
  });
}

/**
 * Ensures exactly one `emp_system_holdings` row for the winner on this system;
 * deletes other empires' holdings for that system.
 */
export async function reconcileSystemHolding(
  ctx: MutationCtx,
  params: {
    gameId: Id<"sim_games">;
    systemId: Id<"gal_systems">;
    winnerEmpireId: Id<"emp_states">;
    winnerGameActorId?: Id<"sim_game_actors">;
  },
): Promise<void> {
  const winnerGameActorId = await resolveWinnerGameActorId(ctx, params);
  const holdings = await ctx.db
    .query("emp_system_holdings")
    .withIndex("by_gameId_and_systemId", (q) =>
      q.eq("gameId", params.gameId).eq("systemId", params.systemId),
    )
    .take(16);

  let winnerHasHolding = false;
  for (const holding of holdings) {
    if (holding.empireId === params.winnerEmpireId) {
      winnerHasHolding = true;
      if ((holding.gameActorId ?? null) !== winnerGameActorId) {
        await ctx.db.patch("emp_system_holdings", holding._id, {
          gameActorId: winnerGameActorId ?? undefined,
        });
      }
    } else {
      await ctx.db.delete("emp_system_holdings", holding._id);
    }
  }

  if (!winnerHasHolding) {
    await ctx.db.insert("emp_system_holdings", {
      gameId: params.gameId,
      empireId: params.winnerEmpireId,
      ...(winnerGameActorId !== null ? { gameActorId: winnerGameActorId } : {}),
      systemId: params.systemId,
      taxRate: 0.18,
      productionModifier: 1,
      unrest: 0.12,
    });
  }
}
