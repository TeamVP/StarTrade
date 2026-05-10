import type { MutationCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";

export async function findLinkBetweenSystems(
  ctx: MutationCtx,
  gameId: Id<"sim_games">,
  fromSystemId: Id<"gal_systems">,
  toSystemId: Id<"gal_systems">,
): Promise<Doc<"gal_links"> | null> {
  const forward = await ctx.db
    .query("gal_links")
    .withIndex("by_gameId_and_fromSystemId", (q) =>
      q.eq("gameId", gameId).eq("fromSystemId", fromSystemId),
    )
    .take(32);
  const alongForward = forward.find((row) => row.toSystemId === toSystemId);
  if (alongForward !== undefined) {
    return alongForward;
  }

  const backward = await ctx.db
    .query("gal_links")
    .withIndex("by_gameId_and_fromSystemId", (q) =>
      q.eq("gameId", gameId).eq("fromSystemId", toSystemId),
    )
    .take(32);
  const alongBackward = backward.find((row) => row.toSystemId === fromSystemId);
  return alongBackward ?? null;
}
