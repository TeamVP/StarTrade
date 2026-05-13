import { query } from "../_generated/server";
import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";

export const listColonyShipsForGame = query({
  args: { gameId: v.id("sim_games"), limit: v.number() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("col_colony_ships")
      .withIndex("by_gameId", (q) => q.eq("gameId", args.gameId))
      .take(args.limit);
  },
});

/** Colony ships for the caller's empire (or all, if game admin). */
export const listMyColonyShips = query({
  args: { gameId: v.id("sim_games"), limit: v.number() },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return [];

    const binding = await ctx.db
      .query("usr_game_roles")
      .withIndex("by_gameId_and_userId", (q) =>
        q.eq("gameId", args.gameId).eq("userId", userId),
      )
      .unique();

    if (binding === null || !binding.isActive || binding.role === "observer") {
      return [];
    }

    if (binding.role === "admin") {
      return await ctx.db
        .query("col_colony_ships")
        .withIndex("by_gameId", (q) => q.eq("gameId", args.gameId))
        .take(args.limit);
    }

    const empireId = binding.empireId;
    if (empireId === null) return [];

    return await ctx.db
      .query("col_colony_ships")
      .withIndex("by_gameId_and_empireId", (q) =>
        q.eq("gameId", args.gameId).eq("empireId", empireId),
      )
      .take(args.limit);
  },
});
