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
import { getNpcEmpirePlayerByKey, normalizeNpcEmpireKeys } from "../seed/npcEmpirePlayers";
import { getAutomationStrategyByKey } from "../usr/automationStrategyCatalog";
import { getMissionByKey } from "../usr/missionCatalog";
import {
  DEFAULT_TURN_DURATION_MS,
  msUntilTurnBoundary,
  msUntilTurnPreparationStart,
  resumedTurnStartedAt,
  scheduledNextTurnStartedAt,
  shiftPausedDeadline,
} from "./turnTiming";
import { touchGameMeaningfulActivity } from "./helpers";
import { invalidateOpenTurnPreparation } from "./turnPreparationInvalidation";
import { createUniqueGameUrlCode } from "./urlCodes";

async function resolveStarterOwnerDisplayName(
  ctx: MutationCtx,
  userId: Id<"users">,
): Promise<string> {
  const profile = await ctx.db
    .query("usr_profiles")
    .withIndex("by_userId", (q) => q.eq("userId", userId))
    .unique();
  if (profile !== null && profile.displayName.trim().length > 0) {
    return profile.displayName.trim();
  }

  const user = await ctx.db.get("users", userId);
  const userName = user?.name?.trim();
  if (userName && userName.length > 0) {
    return userName;
  }

  const email = user?.email?.trim();
  if (email && email.length > 0) {
    return email;
  }

  return "Player";
}

export async function assignOwnerEmpireSeat(
  ctx: MutationCtx,
  params: { gameId: Id<"sim_games">; userId: Id<"users">; empireKey: string },
): Promise<void> {
  const playerEmpire = await ctx.db
    .query("emp_states")
    .withIndex("by_gameId", (q) => q.eq("gameId", params.gameId))
    .collect()
    .then((rows) => rows.find((row) => row.empireKey === params.empireKey) ?? null);

  if (playerEmpire === null) {
    throw new Error(`Mission owner empire ${params.empireKey} was not seeded.`);
  }

  const playerName = await resolveStarterOwnerDisplayName(ctx, params.userId);
  const existingRole = await ctx.db
    .query("usr_game_roles")
    .withIndex("by_gameId_and_userId", (q) =>
      q.eq("gameId", params.gameId).eq("userId", params.userId),
    )
    .unique();

  if (existingRole === null) {
    await ctx.db.insert("usr_game_roles", {
      gameId: params.gameId,
      userId: params.userId,
      role: "empire",
      empireId: playerEmpire._id,
      joinedAt: Date.now(),
      isActive: true,
    });
  } else if (
    existingRole.role !== "empire" ||
    existingRole.empireId !== playerEmpire._id ||
    !existingRole.isActive
  ) {
    await ctx.db.patch("usr_game_roles", existingRole._id, {
      role: "empire",
      empireId: playerEmpire._id,
      isActive: true,
    });
  }

  await ctx.db.patch("emp_states", playerEmpire._id, {
    controller: "human",
    playerName,
  });
}

export async function assignStarterOwnerEmpireSeat(
  ctx: MutationCtx,
  params: { gameId: Id<"sim_games">; userId: Id<"users"> },
): Promise<void> {
  await assignOwnerEmpireSeat(ctx, {
    gameId: params.gameId,
    userId: params.userId,
    empireKey: "aurora",
  });
}

async function applyMissionScenarioIfNeeded(
  ctx: MutationCtx,
  params: { gameId: Id<"sim_games">; userId: Id<"users">; missionKey: string },
): Promise<void> {
  const game = await ctx.db.get("sim_games", params.gameId);
  if (game === null || game.missionAppliedAt !== undefined) {
    return;
  }

  const mission = await getMissionByKey(ctx, params.missionKey);
  if (mission === null) {
    throw new Error("Mission not found.");
  }

  const empires = await ctx.db
    .query("emp_states")
    .withIndex("by_gameId", (q) => q.eq("gameId", params.gameId))
    .collect();
  const empiresByKey = new Map(empires.map((empire) => [empire.empireKey, empire]));
  const empiresByNpcKey = new Map(
    empires
      .filter((empire) => empire.npcPlayerKey !== undefined)
      .map((empire) => [empire.npcPlayerKey!, empire]),
  );

  await assignOwnerEmpireSeat(ctx, {
    gameId: params.gameId,
    userId: params.userId,
    empireKey: mission.scenario.playerEmpireKey,
  });

  for (const config of mission.scenario.empireConfigs) {
    const empire =
      (config.targetEmpireKey !== null ? empiresByKey.get(config.targetEmpireKey) : undefined) ??
      (config.targetNpcPlayerKey !== null
        ? empiresByNpcKey.get(config.targetNpcPlayerKey)
        : undefined) ??
      null;
    if (empire === null) {
      continue;
    }

    const empirePatch: {
      controller?: "human" | "npc";
      npcPlayerKey?: string;
      strategyJson?: string;
      strategyStartMode?: "turn" | "attacked";
      strategyStartTurn?: number;
      strategyActivatedAtTurn?: number | undefined;
      name?: string;
      playerName?: string;
      treasury?: number;
    } = {};

    const npcPlayer =
      config.targetNpcPlayerKey === null
        ? null
        : await getNpcEmpirePlayerByKey(ctx, config.targetNpcPlayerKey);

    if (config.controller !== null) {
      empirePatch.controller = config.controller;
    }
    if (npcPlayer !== null) {
      empirePatch.npcPlayerKey = npcPlayer.key;
      if (config.playerNameOverride === null) {
        empirePatch.playerName = npcPlayer.playerName;
      }
    }

    const strategyLibraryKey = config.strategyLibraryKey ?? npcPlayer?.strategyLibraryKey ?? null;
    if (strategyLibraryKey !== null) {
      const strategy = await getAutomationStrategyByKey(ctx, strategyLibraryKey);
      if (strategy === null) {
        throw new Error(`Mission strategy ${strategyLibraryKey} was not found.`);
      }
      empirePatch.strategyJson = strategy.strategyJson;
    }
    if (config.strategyStartMode !== null) {
      empirePatch.strategyStartMode = config.strategyStartMode;
      empirePatch.strategyActivatedAtTurn = undefined;
    }
    if (config.strategyStartTurn !== null) {
      empirePatch.strategyStartTurn = config.strategyStartTurn;
      empirePatch.strategyActivatedAtTurn = undefined;
    }
    if (config.empireNameOverride !== null) {
      empirePatch.name = config.empireNameOverride;
    }
    if (config.playerNameOverride !== null) {
      empirePatch.playerName = config.playerNameOverride;
    }
    if (config.treasuryDelta !== 0) {
      empirePatch.treasury = empire.treasury + config.treasuryDelta;
    }

    if (Object.keys(empirePatch).length > 0) {
      await ctx.db.patch("emp_states", empire._id, empirePatch);
    }

    if (empire.homeSystemId !== null) {
      const homeSystem = await ctx.db.get("gal_systems", empire.homeSystemId);
      if (homeSystem !== null) {
        const homePatch: {
          population?: number;
          stockFood?: number;
          stockWeapons?: number;
          stockResearch?: number;
          localTreasury?: number;
        } = {};

        if (config.homeworldPopulationDelta !== 0) {
          homePatch.population = Math.max(
            0,
            (homeSystem.population ?? 0) + config.homeworldPopulationDelta,
          );
        }
        if (config.homeworldStockFoodDelta !== 0) {
          homePatch.stockFood = (homeSystem.stockFood ?? 0) + config.homeworldStockFoodDelta;
        }
        if (config.homeworldStockWeaponsDelta !== 0) {
          homePatch.stockWeapons =
            (homeSystem.stockWeapons ?? 0) + config.homeworldStockWeaponsDelta;
        }
        if (config.homeworldStockResearchDelta !== 0) {
          homePatch.stockResearch =
            (homeSystem.stockResearch ?? 0) + config.homeworldStockResearchDelta;
        }
        if (config.homeworldLocalTreasuryDelta !== 0) {
          homePatch.localTreasury =
            (homeSystem.localTreasury ?? 0) + config.homeworldLocalTreasuryDelta;
        }

        if (Object.keys(homePatch).length > 0) {
          await ctx.db.patch("gal_systems", homeSystem._id, homePatch);
        }
      }
    }
  }

  await ctx.db.patch("sim_games", params.gameId, {
    missionAppliedAt: Date.now(),
  });
}

export const createGame = mutation({
  args: {
    name: v.string(),
    mapKey: v.string(),
    /** Per-game RNG seed (e.g. from `crypto.randomUUID()` on the client). */
    seed: v.string(),
    npcEmpireKeys: v.optional(v.array(v.string())),
    automatedEmpireKeys: v.optional(v.array(v.string())),
    missionKey: v.optional(v.string()),
    lobbyScenarioKey: v.optional(v.string()),
    retentionClass: v.optional(
      v.union(
        v.literal("discarded"),
        v.literal("official"),
        v.literal("archived_debug"),
      ),
    ),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      throw new Error("Authentication required.");
    }

    const npcEmpireKeys = await normalizeNpcEmpireKeys(ctx, args.npcEmpireKeys ?? []);

    const seed = args.seed.trim();
    if (seed.length === 0) {
      throw new Error("RNG seed is required.");
    }

    const now = Date.now();
    const urlCode = await createUniqueGameUrlCode(ctx);
    const gameId = await ctx.db.insert("sim_games", {
      name: args.name,
      urlCode,
      status: "lobby",
      mapKey: args.mapKey,
      turnDurationMs: DEFAULT_TURN_DURATION_MS,
      currentTurn: 0,
      seed,
      createdByUserId: userId,
      ownerUserId: args.lobbyScenarioKey !== undefined || args.missionKey !== undefined ? userId : null,
      missionKey: args.missionKey ?? null,
      lobbyScenarioKey: args.lobbyScenarioKey ?? args.missionKey ?? null,
      missionAppliedAt: undefined,
      startedAt: null,
      endedAt: null,
      winnerEmpireKey: null,
      finalizationState: "none",
      retentionClass: args.retentionClass ?? "official",
      lastMeaningfulActivityAt: now,
      lastHumanActionAt: now,
      abandonmentEligibleAt: now + 7 * 24 * 60 * 60 * 1000,
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

      const automatedEmpireKeys = new Set(args.automatedEmpireKeys ?? []);
      if (automatedEmpireKeys.size > 0) {
        const empires = await ctx.db
          .query("emp_states")
          .withIndex("by_gameId", (q) => q.eq("gameId", gameId))
          .collect();
        for (const empire of empires) {
          if (!automatedEmpireKeys.has(empire.empireKey)) {
            continue;
          }
          await ctx.db.patch("emp_states", empire._id, {
            controller: "npc",
            strategyJson: empire.strategyJson ?? "{}",
            playerName: empire.playerName ?? `${empire.name} AI`,
          });
        }
      }

      const missionKey = args.missionKey ?? args.lobbyScenarioKey;
      if (missionKey !== undefined) {
        await applyMissionScenarioIfNeeded(ctx, { gameId, userId, missionKey });
      }
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

    const game = await ctx.db.get("sim_games", args.gameId);
    if (game === null) {
      throw new Error("Game not found.");
    }
    const isOwnedMissionGame = game.ownerUserId !== null && game.ownerUserId === userId;
    if (!isOwnedMissionGame) {
      await assertGameAdmin(ctx, args.gameId, userId);
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

    const missionKey = game.missionKey ?? game.lobbyScenarioKey;
    if (missionKey !== null && game.missionAppliedAt === undefined) {
      await applyMissionScenarioIfNeeded(ctx, {
        gameId: args.gameId,
        userId,
        missionKey,
      });
    }

    const now = Date.now();
    await ctx.db.patch("sim_games", args.gameId, {
      status: "running",
      startedAt: now,
      currentTurn: 1,
      finalizationState: "none",
      lastMeaningfulActivityAt: now,
      lastHumanActionAt: now,
      abandonmentEligibleAt: now + 7 * 24 * 60 * 60 * 1000,
    });

    await ctx.db.insert("sim_turns", {
      gameId: args.gameId,
      turnNumber: 1,
      startedAt: now,
      resolvedAt: null,
      state: "open",
    });
    await ctx.db.insert("sim_turn_preparations", {
      gameId: args.gameId,
      turnNumber: 1,
      targetBoundaryAt: scheduledNextTurnStartedAt({
        turnStartedAtMs: now,
        turnDurationMs: game.turnDurationMs,
      }),
      state: "queued",
      requestedAt: now,
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

    await ctx.scheduler.runAfter(
      msUntilTurnPreparationStart({
        nowMs: now,
        turnStartedAtMs: now,
        turnDurationMs: game.turnDurationMs,
      }),
      internal.sim.actions.attemptResolveTurnBoundary,
      { gameId: args.gameId },
    );

    await ctx.scheduler.runAfter(
      msUntilTurnBoundary({
        nowMs: now,
        turnStartedAtMs: now,
        turnDurationMs: game.turnDurationMs,
      }),
      internal.sim.actions.attemptResolveTurnBoundary,
      { gameId: args.gameId },
    );

    await touchGameMeaningfulActivity(ctx, args.gameId, {
      humanAction: true,
      now,
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

    const committed = await ctx.runMutation(internal.sim.internal.commitPreparedTurn, {
      gameId: args.gameId,
      turnNumber: gameRow.currentTurn,
    });
    if (committed.committed) {
      await touchGameMeaningfulActivity(ctx, args.gameId, {
        humanAction: true,
      });
      return {
        accepted: true,
        turnNumber: committed.nextTurn,
        alreadyResolving: false,
      };
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
    await touchGameMeaningfulActivity(ctx, args.gameId, {
      humanAction: true,
    });
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
    if (turnRow?.state !== undefined && turnRow.state !== "open") {
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

      await invalidateOpenTurnPreparation(ctx, args.gameId);
      await touchGameMeaningfulActivity(ctx, args.gameId, { humanAction: true });

      return { mode: args.mode, deletedCount: deleted, createdCount: 0 } as const;
    }

    if (args.mode === "buildBlank") {
      const created = await buildBlankOwnedGarrisonRoutes(ctx, { gameId: args.gameId });
      await invalidateOpenTurnPreparation(ctx, args.gameId);
      await touchGameMeaningfulActivity(ctx, args.gameId, { humanAction: true });
      return { mode: args.mode, deletedCount: 0, createdCount: created } as const;
    }

    const deleted = await deleteAllGarrisonRoutesForGame(ctx, args.gameId);
    await applyNpcStrategy(ctx, {
      gameId: args.gameId,
      turnNumber: game.currentTurn,
    });
    await invalidateOpenTurnPreparation(ctx, args.gameId);
    await touchGameMeaningfulActivity(ctx, args.gameId, { humanAction: true });
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
    if (turnRow?.state !== undefined && turnRow.state !== "open") {
      throw new Error("Wait until this turn finishes resolving.");
    }

    const r = clampDelayRatio(args.delayRatio);
    if (r === 0) {
      await ctx.db.patch("sim_games", args.gameId, { nextTurnAutoResolveDelayRatio: undefined });
    } else {
      await ctx.db.patch("sim_games", args.gameId, { nextTurnAutoResolveDelayRatio: r });
    }
    await touchGameMeaningfulActivity(ctx, args.gameId, { humanAction: true });
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
    const turnRow = await ctx.db
      .query("sim_turns")
      .withIndex("by_gameId_and_turnNumber", (q) =>
        q.eq("gameId", args.gameId).eq("turnNumber", game.currentTurn),
      )
      .unique();
    if (turnRow?.state !== undefined && turnRow.state !== "open") {
      throw new Error("Cannot pause unless the current turn is open for orders.");
    }
    await ctx.db.patch("sim_games", args.gameId, {
      status: "paused",
      turnPausedAtMs: Date.now(),
    });
    await touchGameMeaningfulActivity(ctx, args.gameId, { humanAction: true });
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
    const resumedAt = Date.now();
    const pausedAt = game.turnPausedAtMs;
    let activeTurnStartedAt: number | null = null;
    if (pausedAt !== undefined) {
      const turnRow = await ctx.db
        .query("sim_turns")
        .withIndex("by_gameId_and_turnNumber", (q) =>
          q.eq("gameId", args.gameId).eq("turnNumber", game.currentTurn),
        )
        .unique();
      if (turnRow !== null && turnRow.state === "open") {
        activeTurnStartedAt = resumedTurnStartedAt({
          turnStartedAtMs: turnRow.startedAt,
          pausedAtMs: pausedAt,
          resumedAtMs: resumedAt,
        });
        await ctx.db.patch("sim_turns", turnRow._id, {
          startedAt: activeTurnStartedAt,
        });
        const preparationRow = await ctx.db
          .query("sim_turn_preparations")
          .withIndex("by_gameId_and_turnNumber", (q) =>
            q.eq("gameId", args.gameId).eq("turnNumber", game.currentTurn),
          )
          .unique();
        if (preparationRow !== null) {
          await ctx.db.patch("sim_turn_preparations", preparationRow._id, {
            targetBoundaryAt: scheduledNextTurnStartedAt({
              turnStartedAtMs: activeTurnStartedAt,
              turnDurationMs: game.turnDurationMs,
            }),
          });
        }
      } else if (turnRow !== null) {
        activeTurnStartedAt = turnRow.startedAt;
      }
    }

    await ctx.db.patch("sim_games", args.gameId, {
      status: "running",
      turnPausedAtMs: undefined,
      turnPausedUntilMs:
        pausedAt !== undefined && game.turnPausedUntilMs !== undefined
          ? shiftPausedDeadline({
              deadlineMs: game.turnPausedUntilMs,
              pausedAtMs: pausedAt,
              resumedAtMs: resumedAt,
            })
          : game.turnPausedUntilMs,
    });

    if (activeTurnStartedAt !== null) {
      await ctx.scheduler.runAfter(
        msUntilTurnPreparationStart({
          nowMs: resumedAt,
          turnStartedAtMs: activeTurnStartedAt,
          turnDurationMs: game.turnDurationMs,
        }),
        internal.sim.actions.attemptResolveTurnBoundary,
        { gameId: args.gameId },
      );
      await ctx.scheduler.runAfter(
        msUntilTurnBoundary({
          nowMs: resumedAt,
          turnStartedAtMs: activeTurnStartedAt,
          turnDurationMs: game.turnDurationMs,
        }),
        internal.sim.actions.attemptResolveTurnBoundary,
        { gameId: args.gameId },
      );
    }
    await touchGameMeaningfulActivity(ctx, args.gameId, { humanAction: true });
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
    await touchGameMeaningfulActivity(ctx, args.gameId, { humanAction: true });
    return { disabled: args.disabled } as const;
  },
});
