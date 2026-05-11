import { query } from "../_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";

export const getMyProfile = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      return null;
    }

    return await ctx.db
      .query("usr_profiles")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .unique();
  },
});

export const listMyRoles = query({
  args: { gameId: v.id("sim_games") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      return [];
    }

    const role = await ctx.db
      .query("usr_game_roles")
      .withIndex("by_gameId_and_userId", (q) =>
        q.eq("gameId", args.gameId).eq("userId", userId),
      )
      .unique();

    if (role === null || !role.isActive) {
      return [];
    }
    return [role];
  },
});

export const listGamePlayersForAdmin = query({
  args: { gameId: v.id("sim_games"), limit: v.number() },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      return [];
    }

    const binding = await ctx.db
      .query("usr_game_roles")
      .withIndex("by_gameId_and_userId", (q) =>
        q.eq("gameId", args.gameId).eq("userId", userId),
      )
      .unique();
    if (binding === null || !binding.isActive || binding.role !== "admin") {
      return [];
    }

    const roles = [];
    for (const role of ["admin", "empire", "trader", "observer"] as const) {
      const rows = await ctx.db
        .query("usr_game_roles")
        .withIndex("by_gameId_and_role", (q) =>
          q.eq("gameId", args.gameId).eq("role", role),
        )
        .take(args.limit);
      roles.push(...rows);
    }

    const activeRoles = roles.filter((role) => role.isActive).slice(0, args.limit);
    const result = [];
    for (const role of activeRoles) {
      const profile = await ctx.db
        .query("usr_profiles")
        .withIndex("by_userId", (q) => q.eq("userId", role.userId))
        .unique();
      result.push({
        roleId: role._id,
        userId: role.userId,
        role: role.role,
        empireId: role.empireId,
        displayName: profile?.displayName ?? `Player ${role.userId.slice(-4)}`,
      });
    }
    return result;
  },
});
