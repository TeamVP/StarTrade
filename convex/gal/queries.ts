import { query } from "../_generated/server";
import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";

export const listSystems = query({
  args: { gameId: v.id("sim_games"), limit: v.number() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("gal_systems")
      .withIndex("by_gameId", (q) => q.eq("gameId", args.gameId))
      .take(args.limit);
  },
});

export const listLinksFromSystem = query({
  args: { gameId: v.id("sim_games"), fromSystemId: v.id("gal_systems") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("gal_links")
      .withIndex("by_gameId_and_fromSystemId", (q) =>
        q.eq("gameId", args.gameId).eq("fromSystemId", args.fromSystemId),
      )
      .take(256);
  },
});

export const listLinks = query({
  args: { gameId: v.id("sim_games"), limit: v.number() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("gal_links")
      .withIndex("by_gameId", (q) => q.eq("gameId", args.gameId))
      .take(args.limit);
  },
});

export const listMyPriorityStars = query({
  args: {
    gameId: v.id("sim_games"),
    empireId: v.optional(v.id("emp_states")),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return [];

    const binding = await ctx.db
      .query("usr_game_roles")
      .withIndex("by_gameId_and_userId", (q) =>
        q.eq("gameId", args.gameId).eq("userId", userId),
      )
      .unique();
    if (binding === null || !binding.isActive) {
      return [];
    }

    let empireId = binding.role === "empire" ? binding.empireId : null;
    if (binding.role === "admin" && args.empireId !== undefined) {
      const empire = await ctx.db.get("emp_states", args.empireId);
      if (empire === null || empire.gameId !== args.gameId) return [];
      empireId = empire._id;
    }
    if (empireId === null) return [];

    return await ctx.db
      .query("emp_priority_stars")
      .withIndex("by_gameId_and_empireId", (q) =>
        q.eq("gameId", args.gameId).eq("empireId", empireId),
      )
      .take(256);
  },
});
