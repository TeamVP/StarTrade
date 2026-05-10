import { mutation } from "../_generated/server";
import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";

export const upsertMyProfile = mutation({
  args: {
    displayName: v.string(),
    avatarUrl: v.union(v.string(), v.null()),
    timezone: v.union(v.string(), v.null()),
    analyticsConsent: v.boolean(),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      throw new Error("Authentication required.");
    }

    const existing = await ctx.db
      .query("usr_profiles")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .unique();

    if (existing === null) {
      return await ctx.db.insert("usr_profiles", { userId, ...args });
    }

    await ctx.db.patch("usr_profiles", existing._id, args);
    return existing._id;
  },
});
