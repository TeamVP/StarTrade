import { mutation } from "../_generated/server";
import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";

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

    if (charter.traderUserId !== userId) {
      throw new Error("Charter is not assigned to this user.");
    }

    await ctx.db.patch("trd_charters", args.charterId, { status: "active" });
    return args.charterId;
  },
});
