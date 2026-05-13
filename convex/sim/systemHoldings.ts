import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

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
  },
): Promise<void> {
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
    } else {
      await ctx.db.delete("emp_system_holdings", holding._id);
    }
  }

  if (!winnerHasHolding) {
    await ctx.db.insert("emp_system_holdings", {
      gameId: params.gameId,
      empireId: params.winnerEmpireId,
      systemId: params.systemId,
      taxRate: 0.18,
      productionModifier: 1,
      unrest: 0.12,
    });
  }
}
