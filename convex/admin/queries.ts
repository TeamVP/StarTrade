import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { query } from "../_generated/server";

export const listUsers = query({
  args: {
    gameId: v.union(v.id("sim_games"), v.null()),
    limit: v.number(),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null || args.gameId === null) {
      return { authorized: false, users: [] };
    }
    const gameId = args.gameId;

    const binding = await ctx.db
      .query("usr_game_roles")
      .withIndex("by_gameId_and_userId", (q) =>
        q.eq("gameId", gameId).eq("userId", userId),
      )
      .unique();

    if (binding === null || !binding.isActive || binding.role !== "admin") {
      return { authorized: false, users: [] };
    }

    const limit = Math.min(Math.max(Math.floor(args.limit), 1), 100);
    const users = await ctx.db.query("users").order("desc").take(limit);
    const rows = [];

    for (const user of users) {
      const profile = await ctx.db
        .query("usr_profiles")
        .withIndex("by_userId", (q) => q.eq("userId", user._id))
        .unique();

      rows.push({
        _id: user._id,
        createdAt: user._creationTime,
        email: user.email ?? null,
        name: user.name ?? null,
        image: user.image ?? null,
        isAnonymous: user.isAnonymous ?? false,
        emailVerified: user.emailVerificationTime !== undefined,
        displayName: profile?.displayName ?? null,
        timezone: profile?.timezone ?? null,
      });
    }

    return {
      authorized: true,
      users: rows,
    };
  },
});