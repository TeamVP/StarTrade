import { query } from "../_generated/server";
import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";

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

/** Used by the galaxy map to sync turn progress with en-route fleet animation. */
export const getTurnTimelineForGame = query({
  args: { gameId: v.id("sim_games") },
  handler: async (ctx, args) => {
    const game = await ctx.db.get("sim_games", args.gameId);
    if (game === null) {
      return null;
    }
    const turnRow = await ctx.db
      .query("sim_turns")
      .withIndex("by_gameId_and_turnNumber", (q) =>
        q.eq("gameId", args.gameId).eq("turnNumber", game.currentTurn),
      )
      .unique();
    return {
      currentTurn: game.currentTurn,
      turnDurationMs: game.turnDurationMs,
      turnStartedAt: turnRow?.startedAt ?? null,
    };
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

/**
 * Cursor-paginated event history for the /history screen.
 *
 * When `eventType` is provided the `by_gameId_and_eventType` index is used
 * so the DB does not scan unrelated rows.  With no filter the full game
 * log is paged newest-first via `by_gameId`.
 */
export const listEventsPaginated = query({
  args: {
    gameId: v.id("sim_games"),
    paginationOpts: paginationOptsValidator,
    /** Exact event type string to filter on, e.g. "battle_started". Omit for all. */
    eventType: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    if (args.eventType !== undefined) {
      return await ctx.db
        .query("sim_events")
        .withIndex("by_gameId_and_eventType", (q) =>
          q.eq("gameId", args.gameId).eq("eventType", args.eventType as string),
        )
        .order("desc")
        .paginate(args.paginationOpts);
    }
    return await ctx.db
      .query("sim_events")
      .withIndex("by_gameId", (q) => q.eq("gameId", args.gameId))
      .order("desc")
      .paginate(args.paginationOpts);
  },
});
