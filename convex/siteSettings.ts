import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";

const AUTH_SETTINGS_KEY = "global";

async function loadAuthSettings(ctx: QueryCtx) {
  const row = await ctx.db
    .query("site_settings")
    .withIndex("by_key", (q) => q.eq("key", AUTH_SETTINGS_KEY))
    .unique();

  return {
    googleOauthEnabled: row?.googleOauthEnabled ?? true,
  };
}

async function assertAdmin(ctx: MutationCtx) {
  const userId = await getAuthUserId(ctx);
  if (userId === null) {
    throw new Error("You must be signed in to update site settings.");
  }

  const user = await ctx.db.get("users", userId);
  if (user?.admin !== true) {
    throw new Error("Admin access required.");
  }
}

export const getAuthSettings = query({
  args: {},
  handler: async (ctx) => {
    return await loadAuthSettings(ctx);
  },
});

export const updateAuthSettings = mutation({
  args: {
    googleOauthEnabled: v.boolean(),
  },
  handler: async (ctx, args) => {
    await assertAdmin(ctx);

    const existing = await ctx.db
      .query("site_settings")
      .withIndex("by_key", (q) => q.eq("key", AUTH_SETTINGS_KEY))
      .unique();

    const next = {
      key: AUTH_SETTINGS_KEY,
      googleOauthEnabled: args.googleOauthEnabled,
    };

    if (existing === null) {
      await ctx.db.insert("site_settings", next);
    } else {
      await ctx.db.patch(existing._id, next);
    }

    return next;
  },
});
