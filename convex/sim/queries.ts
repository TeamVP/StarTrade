import { query } from "../_generated/server";
import { v } from "convex/values";

export const listGames = query({
  args: { limit: v.number() },
  handler: async (ctx, args) => {
    return await ctx.db.query("sim_games").order("desc").take(args.limit);
  },
});

export const getGame = query({
  args: { gameId: v.id("sim_games") },
  handler: async (ctx, args) => {
    return await ctx.db.get("sim_games", args.gameId);
  },
});

export const listRecentEvents = query({
  args: { gameId: v.id("sim_games"), limit: v.number() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("sim_events")
      .withIndex("by_gameId", (q) => q.eq("gameId", args.gameId))
      .order("desc")
      .take(args.limit);
  },
});

export const listEventsByTurn = query({
  args: {
    gameId: v.id("sim_games"),
    turnNumber: v.number(),
    limit: v.number(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("sim_events")
      .withIndex("by_gameId_and_turnNumber", (q) =>
        q.eq("gameId", args.gameId).eq("turnNumber", args.turnNumber),
      )
      .order("desc")
      .take(args.limit);
  },
});
