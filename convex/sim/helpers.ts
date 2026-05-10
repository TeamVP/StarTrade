import type { MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";

export async function assertGameAdmin(
  ctx: MutationCtx,
  gameId: Id<"sim_games">,
  userId: Id<"users">,
): Promise<void> {
  const binding = await ctx.db
    .query("usr_game_roles")
    .withIndex("by_gameId_and_userId", (q) =>
      q.eq("gameId", gameId).eq("userId", userId),
    )
    .unique();

  if (binding === null || !binding.isActive || binding.role !== "admin") {
    throw new Error("Only game admins can perform this action.");
  }
}

export async function assertCanStepTurn(
  ctx: MutationCtx,
  gameId: Id<"sim_games">,
  userId: Id<"users">,
): Promise<void> {
  const binding = await ctx.db
    .query("usr_game_roles")
    .withIndex("by_gameId_and_userId", (q) =>
      q.eq("gameId", gameId).eq("userId", userId),
    )
    .unique();

  if (binding === null || !binding.isActive) {
    throw new Error("You are not a member of this game.");
  }
  if (binding.role !== "admin" && binding.role !== "empire") {
    throw new Error("Only admins and empire players can advance the turn.");
  }
}
