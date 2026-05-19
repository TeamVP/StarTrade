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
import {
  getMissionPlayerSlotKey,
  getMissionByKey,
} from "../usr/missionCatalog";
import {
  DEFAULT_TURN_DURATION_MS,
  resumedTurnStartedAt,
  scheduledNextTurnStartedAt,
  shiftPausedDeadline,
} from "./turnTiming";
import { scheduleGameTurnWakeups } from "./wakeScheduler";
import { touchGameMeaningfulActivity } from "./helpers";
import { invalidateOpenTurnPreparation } from "./turnPreparationInvalidation";
import { createUniqueGameUrlCode } from "./urlCodes";
import type { GameMode } from "./gameMode";

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
    empireKey: getMissionPlayerSlotKey(mission.scenario),
  });
  for (const slot of mission.scenario.slots) {
    const occupantNpcKey = slot.occupant.kind === "npc" ? slot.occupant.npcPlayerKey : null;
    const empire =
      empiresByKey.get(slot.slotKey) ??
      (occupantNpcKey !== null
        ? empiresByNpcKey.get(occupantNpcKey)
        : undefined) ??
      null;
    if (empire === null) {
      continue;
    }

    const empirePatch: {
      controller?: "human" | "npc";
      npcPlayerKey?: string;
      strategyJson?: string;
      strategyLibraryKey?: string | null;
      strategyStartMode?: "turn" | "attacked" | "intruder_detection";
      strategyStartTurn?: number | undefined;
      strategyStartRouteSteps?: number | undefined;
      strategyStartRequireNewEmpire?: boolean | undefined;
      strategyActivatedAtTurn?: number | undefined;
      missionStartsHidden?: boolean;
      missionRevealedAtTurn?: number | undefined;
      missionRevealTriggerMode?: "turn" | "attacked" | "intruder_detection" | undefined;
      missionRevealTurn?: number | undefined;
      missionRevealRouteSteps?: number | undefined;
      missionRevealRequireNewEmpire?: boolean | undefined;
      missionFightAttraction?: number | undefined;
      missionIntruderDetectionRange?: number | undefined;
      missionIntruderDetectionRequireNewEmpire?: boolean | undefined;
      standingOrdersRefreshRequestedAt?: number;
      name?: string;
      playerName?: string;
      treasury?: number;
    } = {};

    const npcPlayer =
      occupantNpcKey === null
        ? null
        : await getNpcEmpirePlayerByKey(ctx, occupantNpcKey);

    if (slot.occupant.kind === "human") {
      empirePatch.controller = "human";
      empirePatch.npcPlayerKey = undefined;
    }
    if (slot.occupant.kind === "npc") {
      empirePatch.controller = "npc";
      empirePatch.strategyStartMode = "turn";
      empirePatch.strategyStartTurn = 1;
      empirePatch.strategyStartRouteSteps = undefined;
      empirePatch.strategyStartRequireNewEmpire = undefined;
      empirePatch.strategyActivatedAtTurn = undefined;
    }

    if (npcPlayer !== null) {
      empirePatch.npcPlayerKey = npcPlayer.key;
      if (slot.presentation.displayNameOverride === null) {
        empirePatch.playerName = npcPlayer.playerName;
      }
    }

    const strategyLibraryKey =
      slot.automation.strategyLibraryKey ?? npcPlayer?.strategyLibraryKey ?? null;
    empirePatch.strategyLibraryKey = strategyLibraryKey;
    if (strategyLibraryKey !== null) {
      const strategy = await getAutomationStrategyByKey(ctx, strategyLibraryKey);
      if (strategy === null) {
        throw new Error(`Mission strategy ${strategyLibraryKey} was not found.`);
      }
      empirePatch.strategyJson = strategy.strategyJson;
    }
    if (slot.automation.activationTrigger?.kind === "attacked") {
      empirePatch.strategyStartMode = "attacked";
      empirePatch.strategyStartTurn = undefined;
      empirePatch.strategyStartRouteSteps = undefined;
      empirePatch.strategyStartRequireNewEmpire = undefined;
      empirePatch.strategyActivatedAtTurn = undefined;
    }
    if (slot.automation.activationTrigger?.kind === "turn") {
      empirePatch.strategyStartMode = "turn";
      empirePatch.strategyStartTurn = slot.automation.activationTrigger.turn;
      empirePatch.strategyStartRouteSteps = undefined;
      empirePatch.strategyStartRequireNewEmpire = undefined;
      empirePatch.strategyActivatedAtTurn = undefined;
    }
    if (slot.automation.activationTrigger?.kind === "intruder_detection") {
      empirePatch.strategyStartMode = "intruder_detection";
      empirePatch.strategyStartTurn = undefined;
      empirePatch.strategyStartRouteSteps = slot.automation.activationTrigger.routeSteps;
      empirePatch.strategyStartRequireNewEmpire =
        slot.automation.activationTrigger.requireNewEmpire;
      empirePatch.strategyActivatedAtTurn = undefined;
    }

    empirePatch.missionStartsHidden = slot.startsHidden;
    empirePatch.missionRevealedAtTurn = slot.startsHidden ? undefined : 0;
    empirePatch.missionRevealTriggerMode = undefined;
    empirePatch.missionRevealTurn = undefined;
    empirePatch.missionRevealRouteSteps = undefined;
    empirePatch.missionRevealRequireNewEmpire = undefined;
    if (slot.revealTrigger?.kind === "turn") {
      empirePatch.missionRevealTriggerMode = "turn";
      empirePatch.missionRevealTurn = slot.revealTrigger.turn;
    }
    if (slot.revealTrigger?.kind === "attacked") {
      empirePatch.missionRevealTriggerMode = "attacked";
    }
    if (slot.revealTrigger?.kind === "intruder_detection") {
      empirePatch.missionRevealTriggerMode = "intruder_detection";
      empirePatch.missionRevealRouteSteps = slot.revealTrigger.routeSteps;
      empirePatch.missionRevealRequireNewEmpire = slot.revealTrigger.requireNewEmpire;
    }
    empirePatch.missionFightAttraction = slot.sensors.fightAttraction ?? undefined;
    empirePatch.missionIntruderDetectionRange =
      slot.sensors.intruderDetection?.routeSteps ?? undefined;
    empirePatch.missionIntruderDetectionRequireNewEmpire =
      slot.sensors.intruderDetection?.requireNewEmpire ?? undefined;
    empirePatch.standingOrdersRefreshRequestedAt = Date.now();

    if (slot.presentation.factionLabelOverride !== null) {
      empirePatch.name = slot.presentation.factionLabelOverride;
    }
    if (slot.presentation.displayNameOverride !== null) {
      empirePatch.playerName = slot.presentation.displayNameOverride;
    }
    if (slot.resources.treasuryDelta !== 0) {
      empirePatch.treasury = empire.treasury + slot.resources.treasuryDelta;
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

        if (slot.resources.homeworldPopulationDelta !== 0) {
          homePatch.population = Math.max(
            0,
            (homeSystem.population ?? 0) + slot.resources.homeworldPopulationDelta,
          );
        }
        if (slot.resources.homeworldStockFoodDelta !== 0) {
          homePatch.stockFood = Math.max(
            0,
            (homeSystem.stockFood ?? 0) + slot.resources.homeworldStockFoodDelta,
          );
        }
        if (slot.resources.homeworldStockWeaponsDelta !== 0) {
          homePatch.stockWeapons = Math.max(
            0,
            (homeSystem.stockWeapons ?? 0) + slot.resources.homeworldStockWeaponsDelta,
          );
        }
        if (slot.resources.homeworldStockResearchDelta !== 0) {
          homePatch.stockResearch = Math.max(
            0,
            (homeSystem.stockResearch ?? 0) + slot.resources.homeworldStockResearchDelta,
          );
        }
        if (slot.resources.homeworldLocalTreasuryDelta !== 0) {
          homePatch.localTreasury = Math.max(
            0,
            (homeSystem.localTreasury ?? 0) + slot.resources.homeworldLocalTreasuryDelta,
          );
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

async function resolveRequestedGameMode(
  ctx: MutationCtx,
  params: {
    userId: Id<"users">;
    mode?: GameMode;
    missionKey?: string;
    lobbyScenarioKey?: string;
  },
): Promise<GameMode> {
  const missionKey = params.missionKey ?? params.lobbyScenarioKey;
  const mission = missionKey === undefined ? null : await getMissionByKey(ctx, missionKey);
  if (missionKey !== undefined && mission === null) {
    throw new Error("Unknown mission.");
  }

  const requestedMode = params.mode ?? mission?.mode ?? "conquest_core";
  if (mission !== null && params.mode !== undefined && params.mode !== mission.mode) {
    throw new Error("Game mode does not match the selected mission.");
  }

  const user = await ctx.db.get("users", params.userId);
  if (user === null) {
    throw new Error("User not found.");
  }

  if (requestedMode === "conquest_plus" && !user.admin) {
    throw new Error("Conquest plus is unpublished.");
  }

  const needsPro = requestedMode === "trader_economy" || mission?.requiredTier === "pro";
  if (needsPro && !user.admin && user.plan !== "pro") {
    throw new Error("Pro is required to create this game mode.");
  }

  return requestedMode;
}

function strategyFingerprint(strategyJson: string): string {
  let hash = 2166136261;
  for (let index = 0; index < strategyJson.length; index += 1) {
    hash ^= strategyJson.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

async function ensureGameActorsForRuntimeVersion(
  ctx: MutationCtx,
  params: {
    gameId: Id<"sim_games">;
    runtimeVersion: "v1_empire" | "v2_game_actor" | null | undefined;
  },
): Promise<void> {
  if ((params.runtimeVersion ?? "v1_empire") !== "v2_game_actor") {
    return;
  }

  const existingActors = await ctx.db
    .query("sim_game_actors")
    .withIndex("by_gameId", (q) => q.eq("gameId", params.gameId))
    .take(1);
  if (existingActors.length > 0) {
    return;
  }

  const [empires, empireRoles] = await Promise.all([
    ctx.db
      .query("emp_states")
      .withIndex("by_gameId", (q) => q.eq("gameId", params.gameId))
      .collect(),
    ctx.db
      .query("usr_game_roles")
      .withIndex("by_gameId_and_role", (q) => q.eq("gameId", params.gameId).eq("role", "empire"))
      .collect(),
  ]);

  const controllerUserIdByEmpireId = new Map(
    empireRoles
      .filter((role) => role.isActive && role.empireId !== null)
      .map((role) => [role.empireId!, role.userId] as const),
  );

  const now = Date.now();
  const orderedEmpires = [...empires].sort((left, right) =>
    left.empireKey.localeCompare(right.empireKey),
  );
  const actorIdByEmpireId = new Map<Id<"emp_states">, Id<"sim_game_actors">>();

  for (const [slotIndex, empire] of orderedEmpires.entries()) {
    const normalizedStrategy = empire.strategyJson?.trim() ?? "";
    const strategyJsonSnapshot = normalizedStrategy.length > 0 ? normalizedStrategy : null;
    const actorId = await ctx.db.insert("sim_game_actors", {
      gameId: params.gameId,
      slotNumber: slotIndex + 1,
      actorKind: "empire",
      controllerKind: empire.controller === "human" ? "human" : "npc",
      controllerUserId: controllerUserIdByEmpireId.get(empire._id) ?? null,
      npcPlayerKey: empire.npcPlayerKey ?? null,
      legacyEmpireId: empire._id,
      displayNameSnapshot: empire.playerName?.trim() || empire.name,
      factionLabelSnapshot: empire.name,
      colorHex: empire.colorHex,
      strategyLibraryKey: empire.strategyLibraryKey ?? null,
      strategyJsonSnapshot,
      strategyFingerprint:
        strategyJsonSnapshot === null ? null : strategyFingerprint(strategyJsonSnapshot),
      status: empire.resignedAt !== undefined ? "resigned" : empire.isCollapsed ? "eliminated" : "active",
      eliminatedAtTurn: null,
      homeSystemId: empire.homeSystemId,
      createdAt: now,
      updatedAt: now,
    });
    actorIdByEmpireId.set(empire._id, actorId);
  }

  const holdings = await ctx.db
    .query("emp_system_holdings")
    .withIndex("by_gameId", (q) => q.eq("gameId", params.gameId))
    .collect();
  for (const holding of holdings) {
    const actorId = actorIdByEmpireId.get(holding.empireId);
    if ((holding.gameActorId ?? undefined) !== (actorId ?? undefined)) {
      await ctx.db.patch("emp_system_holdings", holding._id, {
        gameActorId: actorId ?? undefined,
      });
    }
  }

  const systems = await ctx.db
    .query("gal_systems")
    .withIndex("by_gameId", (q) => q.eq("gameId", params.gameId))
    .collect();
  for (const system of systems) {
    if (system.ownerEmpireId === null) continue;
    const actorId = actorIdByEmpireId.get(system.ownerEmpireId);
    if ((system.ownerGameActorId ?? undefined) !== (actorId ?? undefined)) {
      await ctx.db.patch("gal_systems", system._id, {
        ownerGameActorId: actorId ?? undefined,
      });
    }
  }

  const fleets = await ctx.db
    .query("flt_fleets")
    .withIndex("by_gameId", (q) => q.eq("gameId", params.gameId))
    .collect();
  for (const fleet of fleets) {
    const actorId = actorIdByEmpireId.get(fleet.empireId);
    if ((fleet.gameActorId ?? undefined) !== (actorId ?? undefined)) {
      await ctx.db.patch("flt_fleets", fleet._id, {
        gameActorId: actorId ?? undefined,
      });
    }
  }

  const colonyShips = await ctx.db
    .query("col_colony_ships")
    .withIndex("by_gameId", (q) => q.eq("gameId", params.gameId))
    .collect();
  for (const ship of colonyShips) {
    const actorId = actorIdByEmpireId.get(ship.empireId);
    if ((ship.gameActorId ?? undefined) !== (actorId ?? undefined)) {
      await ctx.db.patch("col_colony_ships", ship._id, {
        gameActorId: actorId ?? undefined,
      });
    }
  }

  const priorityStars = await ctx.db
    .query("emp_priority_stars")
    .withIndex("by_gameId", (q) => q.eq("gameId", params.gameId))
    .collect();
  for (const row of priorityStars) {
    const actorId = actorIdByEmpireId.get(row.empireId);
    if ((row.gameActorId ?? undefined) !== (actorId ?? undefined)) {
      await ctx.db.patch("emp_priority_stars", row._id, {
        gameActorId: actorId ?? undefined,
      });
    }
  }

  const garrisonRoutes = await ctx.db
    .query("flt_garrison_routes")
    .withIndex("by_gameId", (q) => q.eq("gameId", params.gameId))
    .collect();
  for (const route of garrisonRoutes) {
    const actorId = actorIdByEmpireId.get(route.empireId);
    if ((route.gameActorId ?? undefined) !== (actorId ?? undefined)) {
      await ctx.db.patch("flt_garrison_routes", route._id, {
        gameActorId: actorId ?? undefined,
      });
    }
  }
}

export const createGame = mutation({
  args: {
    name: v.string(),
    mapKey: v.string(),
    runtimeVersion: v.optional(
      v.union(v.literal("v1_empire"), v.literal("v2_game_actor")),
    ),
    mode: v.optional(
      v.union(
        v.literal("conquest_core"),
        v.literal("conquest_plus"),
        v.literal("trader_economy"),
      ),
    ),
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

    const requestedMode = await resolveRequestedGameMode(ctx, {
      userId,
      mode: args.mode,
      missionKey: args.missionKey,
      lobbyScenarioKey: args.lobbyScenarioKey,
    });

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
      runtimeVersion: args.runtimeVersion ?? "v1_empire",
      status: "lobby",
      mapKey: args.mapKey,
      mode: requestedMode,
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
            strategyLibraryKey: null,
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

    await ensureGameActorsForRuntimeVersion(ctx, {
      gameId: args.gameId,
      runtimeVersion: game.runtimeVersion,
    });

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

    await scheduleGameTurnWakeups(ctx, {
      gameId: args.gameId,
      turnStartedAtMs: now,
      turnDurationMs: game.turnDurationMs,
      nowMs: now,
    });

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
  const game = await ctx.db.get("sim_games", params.gameId);
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
  const actorIdByLegacyEmpireId = new Map<Id<"emp_states">, Id<"sim_game_actors">>();
  if ((game?.runtimeVersion ?? "v1_empire") === "v2_game_actor") {
    const actors = await ctx.db
      .query("sim_game_actors")
      .withIndex("by_gameId", (q) => q.eq("gameId", params.gameId))
      .collect();
    for (const actor of actors) {
      if (actor.legacyEmpireId !== null) {
        actorIdByLegacyEmpireId.set(actor.legacyEmpireId, actor._id);
      }
    }
  }

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
        ...(actorIdByLegacyEmpireId.has(empire._id)
          ? { gameActorId: actorIdByLegacyEmpireId.get(empire._id)! }
          : {}),
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
      nextPreparationWakeAt: undefined,
      nextBoundaryWakeAt: undefined,
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
      await scheduleGameTurnWakeups(ctx, {
        gameId: args.gameId,
        turnStartedAtMs: activeTurnStartedAt,
        turnDurationMs: game.turnDurationMs,
        nowMs: resumedAt,
      });
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
