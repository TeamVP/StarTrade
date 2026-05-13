import { mutation } from "../_generated/server";
import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { internal } from "../_generated/api";
import {
  assertCanPauseOrResumeGame,
  assertCanStepTurn,
  assertGameAdmin,
} from "./helpers";
import { normalizeNpcEmpireKeys } from "../seed/npcEmpirePlayers";

export const createGame = mutation({
  args: {
    name: v.string(),
    mapKey: v.string(),
    turnDurationMs: v.number(),
    /** Per-game RNG seed (e.g. from `crypto.randomUUID()` on the client). */
    seed: v.string(),
    npcEmpireKeys: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      throw new Error("Authentication required.");
    }

    const npcEmpireKeys = normalizeNpcEmpireKeys(args.npcEmpireKeys ?? []);

    const seed = args.seed.trim();
    if (seed.length === 0) {
      throw new Error("RNG seed is required.");
    }

    const gameId = await ctx.db.insert("sim_games", {
      name: args.name,
      status: "lobby",
      mapKey: args.mapKey,
      turnDurationMs: args.turnDurationMs,
      currentTurn: 0,
      seed,
      startedAt: null,
      endedAt: null,
      npcEmpireKeys,
    });

    await ctx.db.insert("usr_game_roles", {
      gameId,
      userId,
      role: "admin",
      empireId: null,
      joinedAt: Date.now(),
      isActive: true,
    });

    await ctx.runMutation(internal.admin.internal.seedGameData, {
      gameId,
      mapKey: args.mapKey,
      colorPrefsUserId: userId,
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
      await ctx.runMutation(internal.admin.internal.seedGameData, {
        gameId: args.gameId,
        mapKey: game.mapKey,
        colorPrefsUserId: userId,
      });
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
  handler: async (
    ctx,
    args,
  ): Promise<{ accepted: boolean; turnNumber: number; alreadyResolving: boolean }> => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      throw new Error("Authentication required.");
    }
    await assertCanStepTurn(ctx, args.gameId, userId);

    const gameRow = await ctx.db.get("sim_games", args.gameId);
    if (gameRow === null) {
      throw new Error("Game not found.");
    }
    if (gameRow.status !== "running") {
      throw new Error("Turn can only advance while the game is running.");
    }

    const begin: {
      started: boolean;
      turnNumber: number;
      alreadyResolving: boolean;
    } = await ctx.runMutation(
      internal.sim.internal.beginTurnResolution,
      { gameId: args.gameId },
    );
    if (begin.started) {
      await ctx.scheduler.runAfter(0, internal.sim.actions.resolveTurnJob, {
        gameId: args.gameId,
        turnNumber: begin.turnNumber,
      });
    }
    return {
      accepted: begin.started || begin.alreadyResolving,
      turnNumber: begin.turnNumber,
      alreadyResolving: begin.alreadyResolving,
    };
  },
});

export const pauseGame = mutation({
  args: { gameId: v.id("sim_games") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      throw new Error("Authentication required.");
    }
    await assertCanPauseOrResumeGame(ctx, args.gameId, userId);

    const game = await ctx.db.get("sim_games", args.gameId);
    if (game === null) {
      throw new Error("Game not found.");
    }
    if (game.status !== "running") {
      throw new Error("Only a running game can be paused.");
    }
    await ctx.db.patch("sim_games", args.gameId, { status: "paused" });
    return args.gameId;
  },
});

export const resumeGame = mutation({
  args: { gameId: v.id("sim_games") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      throw new Error("Authentication required.");
    }
    await assertCanPauseOrResumeGame(ctx, args.gameId, userId);

    const game = await ctx.db.get("sim_games", args.gameId);
    if (game === null) {
      throw new Error("Game not found.");
    }
    if (game.status !== "paused") {
      throw new Error("Only a paused game can be resumed.");
    }
    await ctx.db.patch("sim_games", args.gameId, { status: "running" });
    return args.gameId;
  },
});

/**
 * When `disabled` is true, the scheduled cron will not auto-start turn resolution for this game.
 * Does not change lobby/paused/running status; manual stepping still works.
 */
export const setSimCronTurnsDisabled = mutation({
  args: {
    gameId: v.id("sim_games"),
    disabled: v.boolean(),
  },
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
    if (game.status !== "running" && game.status !== "paused") {
      throw new Error("Auto turns can only be toggled for a running or paused game.");
    }

    await ctx.db.patch(args.gameId, {
      simCronTurnsDisabled: args.disabled ? true : undefined,
    });
    return { disabled: args.disabled } as const;
  },
});
