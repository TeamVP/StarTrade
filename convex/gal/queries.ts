import { query } from "../_generated/server";
import { v } from "convex/values";

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
