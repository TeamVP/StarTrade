import { mutation } from "../_generated/server";
import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import {
  assertCanPauseOrResumeGame,
  assertCanStepTurn,
  assertGameAdmin,
  gameAllowsPlayerActions,
} from "./helpers";
import { applyNpcStrategy } from "./economy/applyNpcStrategy";
import { findLinkBetweenSystems } from "../gal/linkUtils";
import { normalizeNpcEmpireKeys } from "../seed/npcEmpirePlayers";
import { DEFAULT_TURN_DURATION_MS } from "./turnTiming";

export const createGame = mutation({
  args: {
    name: v.string(),
    mapKey: v.string(),
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
      turnDurationMs: DEFAULT_TURN_DURATION_MS,
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

    if (args.mapKey === "v1-spiral") {
      await ctx.scheduler.runAfter(0, internal.admin.internal.seedGameData, {
        gameId,
        mapKey: args.mapKey,
        colorPrefsUserId: userId,
      });
    } else {
      await ctx.runMutation(internal.admin.internal.seedGameData, {
        gameId,
        mapKey: args.mapKey,
        colorPrefsUserId: userId,
      });
    }

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

    const hasEmpires = await ctx.db
      .query("emp_states")
      .withIndex("by_gameId", (q) => q.eq("gameId", args.gameId))
      .take(1);

    if (hasEmpires.length === 0) {
      if (game.mapKey === "v1-spiral") {
        await ctx.scheduler.runAfter(0, internal.admin.internal.seedGameData, {
          gameId: args.gameId,
          mapKey: game.mapKey,
          colorPrefsUserId: userId,
        });
        throw new Error(
          "The large galaxy is still loading. Wait a few seconds, then press Start again.",
        );
      }
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

async function buildBlankOwnedGarrisonRoutes(
  ctx: MutationCtx,
  params: { gameId: Id<"sim_games"> },
): Promise<number> {
  const systems = await ctx.db
    .query("gal_systems")
    .withIndex("by_gameId", (q) => q.eq("gameId", params.gameId))
    .take(512);
  const routes = await ctx.db
    .query("flt_garrison_routes")
    .withIndex("by_gameId", (q) => q.eq("gameId", params.gameId))
    .take(512);

  const routesByEmpireOrigin = new Set(
    routes.map((r) => `${r.empireId as string}|${r.originSystemId as string}`),
  );

  const empires = await ctx.db
    .query("emp_states")
    .withIndex("by_gameId", (q) => q.eq("gameId", params.gameId))
    .take(64);

  let created = 0;
  const DEFAULT_DISPATCH_PCT = 25;

  for (const empire of empires) {
    if (empire.isCollapsed) continue;
    const owned = systems
      .filter((s) => s.ownerEmpireId === empire._id)
      .sort((a, b) => a._id.localeCompare(b._id));
    for (const origin of owned) {
      const key = `${empire._id as string}|${origin._id as string}`;
      if (routesByEmpireOrigin.has(key)) continue;

      const candidates = owned
        .filter((s) => s._id !== origin._id)
        .sort((a, b) => a._id.localeCompare(b._id));
      let chosen: (typeof owned)[0] | null = null;
      for (const dest of candidates) {
        const link = await findLinkBetweenSystems(ctx, params.gameId, origin._id, dest._id);
        if (link !== null) {
          chosen = dest;
          break;
        }
      }
      if (chosen === null) continue;

      await ctx.db.insert("flt_garrison_routes", {
        gameId: params.gameId,
        empireId: empire._id,
        originSystemId: origin._id,
        destinationSystemId: chosen._id,
        dispatchPct: DEFAULT_DISPATCH_PCT,
        enabled: true,
        managedByStrategy: false,
      });
      routesByEmpireOrigin.add(key);
      created += 1;
    }
  }

  return created;
}

async function deleteAllGarrisonRoutesForGame(
  ctx: MutationCtx,
  gameId: Id<"sim_games">,
): Promise<number> {
  let deleted = 0;
  for (let pass = 0; pass < 48; pass += 1) {
    const batch = await ctx.db
      .query("flt_garrison_routes")
      .withIndex("by_gameId", (q) => q.eq("gameId", gameId))
      .take(64);
    if (batch.length === 0) break;
    for (const row of batch) {
      await ctx.db.delete("flt_garrison_routes", row._id);
      deleted += 1;
    }
  }
  return deleted;
}

/**
 * Rebuild or extend standing garrison routes for the whole game.
 *
 * - **rebuildCurrent**: Remove automation-managed routes only, then run automation planning once.
 * - **buildBlank**: For each empire, at every owned system with no standing order yet, add a default
 *   manual hop to a linked owned neighbor (if any).
 * - **rebuildAll**: Delete every standing route (manual and automation), then run automation planning.
 */
export const rebuildStandingOrders = mutation({
  args: {
    gameId: v.id("sim_games"),
    mode: v.union(
      v.literal("rebuildCurrent"),
      v.literal("buildBlank"),
      v.literal("rebuildAll"),
    ),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      throw new Error("Authentication required.");
    }
    await assertCanStepTurn(ctx, args.gameId, userId);

    const game = await ctx.db.get("sim_games", args.gameId);
    if (game === null) {
      throw new Error("Game not found.");
    }
    if (!gameAllowsPlayerActions(game.status)) {
      throw new Error("Standing orders can only be changed while the game is running or paused.");
    }

    const turnRow = await ctx.db
      .query("sim_turns")
      .withIndex("by_gameId_and_turnNumber", (q) =>
        q.eq("gameId", args.gameId).eq("turnNumber", game.currentTurn),
      )
      .unique();
    if (turnRow?.state === "resolving") {
      throw new Error("Wait until the current turn finishes resolving, then try again.");
    }

    if (args.mode === "rebuildCurrent") {
      const routes = await ctx.db
        .query("flt_garrison_routes")
        .withIndex("by_gameId", (q) => q.eq("gameId", args.gameId))
        .take(512);

      let deleted = 0;
      for (const route of routes) {
        if (route.managedByStrategy === true) {
          await ctx.db.delete("flt_garrison_routes", route._id);
          deleted += 1;
        }
      }

      await applyNpcStrategy(ctx, {
        gameId: args.gameId,
        turnNumber: game.currentTurn,
      });

      return { mode: args.mode, deletedCount: deleted, createdCount: 0 } as const;
    }

    if (args.mode === "buildBlank") {
      const created = await buildBlankOwnedGarrisonRoutes(ctx, { gameId: args.gameId });
      return { mode: args.mode, deletedCount: 0, createdCount: created } as const;
    }

    const deleted = await deleteAllGarrisonRoutesForGame(ctx, args.gameId);
    await applyNpcStrategy(ctx, {
      gameId: args.gameId,
      turnNumber: game.currentTurn,
    });
    return { mode: args.mode, deletedCount: deleted, createdCount: 0 } as const;
  },
});

function clampDelayRatio(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

/**
 * While the current turn is open for orders, click the planning bar to choose how far
 * into the *next* turn's wall-clock window resolution must wait before it may start
 * (manual Step and cron both respect `turnPausedUntilMs`). Pass 0 to clear a pending choice.
 */
export const scheduleNextTurnResolutionDelay = mutation({
  args: {
    gameId: v.id("sim_games"),
    delayRatio: v.number(),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      throw new Error("Authentication required.");
    }
    await assertCanStepTurn(ctx, args.gameId, userId);

    const game = await ctx.db.get("sim_games", args.gameId);
    if (game === null) {
      throw new Error("Game not found.");
    }
    if (!gameAllowsPlayerActions(game.status)) {
      throw new Error("This can only be set while the game is running or paused.");
    }

    const turnRow = await ctx.db
      .query("sim_turns")
      .withIndex("by_gameId_and_turnNumber", (q) =>
        q.eq("gameId", args.gameId).eq("turnNumber", game.currentTurn),
      )
      .unique();
    if (turnRow?.state === "resolving") {
      throw new Error("Wait until this turn finishes resolving.");
    }

    const r = clampDelayRatio(args.delayRatio);
    if (r === 0) {
      await ctx.db.patch("sim_games", args.gameId, { nextTurnAutoResolveDelayRatio: undefined });
    } else {
      await ctx.db.patch("sim_games", args.gameId, { nextTurnAutoResolveDelayRatio: r });
    }
    return { delayRatio: r } as const;
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

    await ctx.db.patch("sim_games", args.gameId, {
      simCronTurnsDisabled: args.disabled ? true : undefined,
    });
    return { disabled: args.disabled } as const;
  },
});
