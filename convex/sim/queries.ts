import { query } from "../_generated/server";
import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import type { Id } from "../_generated/dataModel";

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

/**
 * Running games with current-turn resolution status for the /games dashboard.
 * Uses only stored timestamps; the client compares `resolvingStartedAt` to `Date.now()`
 * for “stuck resolving” hints (never uses Date.now() here — keeps queries reactive).
 */
export const listRunningGamesTurnProgress = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    const games = await ctx.db
      .query("sim_games")
      .withIndex("by_status", (q) => q.eq("status", "running"))
      .collect();

    const result: {
      gameId: Id<"sim_games">;
      name: string;
      mapKey: string;
      currentTurn: number;
      gameStartedAt: number | null;
      turnPausedUntilMs: number | undefined;
      simCronTurnsDisabled: boolean | undefined;
      turnState: "open" | "resolving" | "resolved" | null;
      resolutionPhase: string | null;
      resolvingStartedAt: number | null;
      viewerCanForceRetry: boolean;
    }[] = [];

    for (const game of games) {
      let viewerCanForceRetry = false;
      if (userId !== null) {
        const binding = await ctx.db
          .query("usr_game_roles")
          .withIndex("by_gameId_and_userId", (q) =>
            q.eq("gameId", game._id).eq("userId", userId),
          )
          .unique();
        viewerCanForceRetry =
          binding !== null && binding.isActive && binding.role === "admin";
      }

      const turnRow = await ctx.db
        .query("sim_turns")
        .withIndex("by_gameId_and_turnNumber", (q) =>
          q.eq("gameId", game._id).eq("turnNumber", game.currentTurn),
        )
        .unique();

      result.push({
        gameId: game._id,
        name: game.name,
        mapKey: game.mapKey,
        currentTurn: game.currentTurn,
        gameStartedAt: game.startedAt,
        turnPausedUntilMs: game.turnPausedUntilMs,
        simCronTurnsDisabled: game.simCronTurnsDisabled,
        turnState: turnRow?.state ?? null,
        resolutionPhase: turnRow?.resolutionPhase ?? null,
        resolvingStartedAt: turnRow?.resolvingStartedAt ?? null,
        viewerCanForceRetry,
      });
    }

    result.sort((a, b) => b.gameId.localeCompare(a.gameId));
    return result;
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
      turnState: turnRow?.state ?? null,
      resolutionPhase: turnRow?.resolutionPhase ?? null,
      simCronTurnsDisabled: game.simCronTurnsDisabled === true,
      turnPausedUntilMs: game.turnPausedUntilMs,
      nextTurnAutoResolveDelayRatio: game.nextTurnAutoResolveDelayRatio,
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
