import { query } from "../_generated/server";
import type { QueryCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";

async function getPlayerTraderIdentityId(
  ctx: QueryCtx,
  gameId: Id<"sim_games">,
  userId: Id<"users">,
) {
  const identities = await ctx.db
    .query("sim_trader_identities")
    .withIndex("by_gameId_and_userId", (q) => q.eq("gameId", gameId).eq("userId", userId))
    .take(2);

  if (identities.length > 1) {
    throw new Error("Multiple trader identities found for this user in the selected game.");
  }

  return identities[0]?._id ?? null;
}

export const listTraderCharters = query({
  args: {
    gameId: v.id("sim_games"),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      return [];
    }

    const traderIdentityId = await getPlayerTraderIdentityId(ctx, args.gameId, userId);
    if (traderIdentityId === null) {
      return [];
    }

    return await ctx.db
      .query("trd_charters")
      .withIndex("by_gameId_and_traderIdentityId", (q) =>
        q.eq("gameId", args.gameId).eq("traderIdentityId", traderIdentityId),
      )
      .take(256);
  },
});
