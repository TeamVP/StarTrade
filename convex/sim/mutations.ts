import { mutation } from "../_generated/server";
import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { internal } from "../_generated/api";
import { assertCanStepTurn, assertGameAdmin } from "./helpers";

export const createGame = mutation({
  args: {
    name: v.string(),
    mapKey: v.string(),
    turnDurationMs: v.number(),
    seed: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      throw new Error("Authentication required.");
    }

    const gameId = await ctx.db.insert("sim_games", {
      name: args.name,
      status: "lobby",
      mapKey: args.mapKey,
      turnDurationMs: args.turnDurationMs,
      currentTurn: 0,
      seed: args.seed,
      startedAt: null,
      endedAt: null,
    });

    await ctx.db.insert("usr_game_roles", {
      gameId,
      userId,
      role: "admin",
      empireId: null,
      joinedAt: Date.now(),
      isActive: true,
    });

    return gameId;
  },
});

export const startGame = mutation({
  args: { gameId: v.id("sim_games") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      throw new Error("Authentication required.");
    }
    await assertGameAdmin(ctx, args.gameId, userId);

    const game = await ctx.db.get("sim_games", args.gameId);
    if (game === null) {
      throw new Error("Game not found.");
    }
    if (game.status !== "lobby") {
      throw new Error("Game has already started or finished.");
    }

    const seeded = await ctx.db
      .query("gal_systems")
      .withIndex("by_gameId", (q) => q.eq("gameId", args.gameId))
      .take(1);
    if (seeded.length === 0) {
      throw new Error("Seed the galaxy before starting.");
    }

    await ctx.db.patch("sim_games", args.gameId, {
      status: "running",
      startedAt: Date.now(),
      currentTurn: 1,
    });

    await ctx.db.insert("sim_turns", {
      gameId: args.gameId,
      turnNumber: 1,
      startedAt: Date.now(),
      resolvedAt: null,
      state: "open",
    });

    await ctx.db.insert("sim_events", {
      gameId: args.gameId,
      turnNumber: 1,
      eventType: "game_started",
      actorType: "sim",
      actorId: args.gameId,
      targetType: null,
      targetId: null,
      summary: "Game started — turn 1",
      payload: JSON.stringify({}),
    });

    return args.gameId;
  },
});

export const stepTurn = mutation({
  args: { gameId: v.id("sim_games") },
  handler: async (ctx, args): Promise<{ resolvedTurn: number; nextTurn: number }> => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      throw new Error("Authentication required.");
    }
    await assertCanStepTurn(ctx, args.gameId, userId);

    const result: { resolvedTurn: number; nextTurn: number } = await ctx.runMutation(
      internal.sim.internal.resolveTurn,
      { gameId: args.gameId },
    );
    return result;
  },
});
