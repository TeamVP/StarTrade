import { mutation } from "../_generated/server";
import type { MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";

async function getPlayerTraderIdentityId(
  ctx: MutationCtx,
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

export const acceptCharter = mutation({
  args: {
    charterId: v.id("trd_charters"),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      throw new Error("Authentication required.");
    }

    const charter = await ctx.db.get("trd_charters", args.charterId);
    if (charter === null) {
      throw new Error("Charter not found.");
    }

    const traderIdentityId = await getPlayerTraderIdentityId(ctx, charter.gameId, userId);
    if (traderIdentityId === null || charter.traderIdentityId !== traderIdentityId) {
      throw new Error("Charter is not assigned to this trader.");
    }

    await ctx.db.patch("trd_charters", args.charterId, { status: "active" });
    return args.charterId;
  },
});
