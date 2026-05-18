import { mutation, query } from "../_generated/server";
import type { MutationCtx } from "../_generated/server";
import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { Scrypt } from "lucia";
import { assertGameAdmin } from "../sim/helpers";
import { evaluateGameFinalization } from "../sim/finalization";
import { createUniqueGameUrlCode, gameUrlCodeNeedsRefresh } from "../sim/urlCodes";
import {
  DEFAULT_GAME_SETTINGS,
  loadGameSettings,
} from "../sim/economy/gameSettings";
import { canonicalizeStrategyJson } from "../usr/automationStrategyLibrary";
import {
  getAutomationStrategyByKey,
} from "../usr/automationStrategyCatalog";
import { BUILT_IN_AUTOMATION_STRATEGY_SEED_ROWS } from "../usr/automationStrategyLibrary";
import { NPC_EMPIRE_PLAYERS, normalizeNpcEmpireKeys } from "../seed/npcEmpirePlayers";
import {
  BUILT_IN_MISSION_SEED_ROWS,
  canonicalizeMissionScenarioJson,
  getMissionByKey,
  parseMissionScenarioJson,
} from "../usr/missionCatalog";
import { gameUsesTraderEconomy, loadGameWithPersistedResolvedMode, loadGameWithResolvedMode } from "../sim/gameMode";
import {
  assertMayTransitionContentStatus,
  resolvePublisherContentReviewStatus,
  isTerminalContentStatus,
  resolvePublisherContentStatus,
} from "../usr/publisherAccess";

function withTraderSettingsReset<T extends typeof DEFAULT_GAME_SETTINGS>(settings: T): T {
  return {
    ...settings,
    traderShipCostMult: DEFAULT_GAME_SETTINGS.traderShipCostMult,
    traderMinActive: DEFAULT_GAME_SETTINGS.traderMinActive,
    traderMaxActive: DEFAULT_GAME_SETTINGS.traderMaxActive,
    traderShipHirePerTurn: DEFAULT_GAME_SETTINGS.traderShipHirePerTurn,
    traderHireChancePct: DEFAULT_GAME_SETTINGS.traderHireChancePct,
    traderDockingCost: DEFAULT_GAME_SETTINGS.traderDockingCost,
    traderLimitsAutomated: DEFAULT_GAME_SETTINGS.traderLimitsAutomated,
  };
}

const LEGACY_GAME_CLEANUP_SCAN_MULTIPLIER = 4;
const PASSWORD_PROVIDER_ID = "password";

function normalizeOptionalUserField(value: string | null | undefined): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function normalizeOptionalPassword(value: string | null | undefined): string | undefined {
  const password = normalizeOptionalUserField(value);
  if (password === undefined) {
    return undefined;
  }
  if (password.length < 8) {
    throw new Error("Password must be at least 8 characters.");
  }
  return password;
}

function normalizeStrategyKey(key: string): string {
  const normalized = key.trim();
  if (normalized.length === 0) {
    throw new Error("Strategy key is required.");
  }
  return normalized;
}

function normalizeStrategyTags(tags: string[]): string[] {
  return tags
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0);
}

function normalizeStrategyDescription(description: string): string {
  return description.trim();
}

function normalizeNpcPlayerKey(key: string): string {
  const normalized = key.trim();
  if (normalized.length === 0) {
    throw new Error("NPC key is required.");
  }
  return normalized;
}

function normalizeNpcPlayerName(name: string, label: string): string {
  const normalized = name.trim();
  if (normalized.length === 0) {
    throw new Error(`${label} is required.`);
  }
  return normalized;
}

function normalizeNpcSortOrder(sortOrder: number): number {
  if (!Number.isFinite(sortOrder)) {
    throw new Error("Sort order must be a number.");
  }
  return Math.max(0, Math.floor(sortOrder));
}

function normalizeNpcColorHex(colorHex: string): string {
  const normalized = colorHex.trim().toLowerCase();
  if (!/^#[0-9a-f]{6}$/.test(normalized)) {
    throw new Error("Color must be a #RRGGBB hex value.");
  }
  return normalized;
}

function normalizeMissionKey(key: string): string {
  const normalized = key.trim();
  if (normalized.length === 0) {
    throw new Error("Mission key is required.");
  }
  return normalized;
}

function normalizeMissionName(name: string): string {
  const normalized = name.trim();
  if (normalized.length === 0) {
    throw new Error("Mission name is required.");
  }
  return normalized;
}

function normalizeMissionDescription(description: string): string {
  return description.trim();
}

function normalizeMissionSortOrder(sortOrder: number): number {
  if (!Number.isFinite(sortOrder)) {
    throw new Error("Mission sort order must be a number.");
  }
  return Math.max(0, Math.floor(sortOrder));
}

function normalizeMissionLevel(level: number): number {
  if (!Number.isFinite(level)) {
    throw new Error("Mission level must be a number.");
  }
  return Math.max(1, Math.floor(level));
}

function normalizeMissionRequiredWins(requiredWins: number): number {
  if (!Number.isFinite(requiredWins)) {
    throw new Error("Mission required wins must be a number.");
  }
  return Math.max(1, Math.floor(requiredWins));
}

function normalizeMissionPrerequisites(prerequisiteMissionKeys: string[]): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const rawKey of prerequisiteMissionKeys) {
    const key = rawKey.trim();
    if (key.length === 0 || seen.has(key)) {
      continue;
    }
    seen.add(key);
    normalized.push(key);
  }
  return normalized;
}

function normalizeModerationNote(note: string | undefined): string | undefined {
  if (note === undefined) {
    return undefined;
  }
  const normalized = note.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function normalizeUniqueKeys<T extends string>(
  values: T[],
  normalizer: (value: string) => T,
): T[] {
  const seen = new Set<T>();
  const normalized: T[] = [];
  for (const value of values) {
    const key = normalizer(value);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    normalized.push(key);
  }
  return normalized;
}

async function normalizeMissionScenarioJson(ctx: MutationCtx, scenarioJson: string): Promise<string> {
  const normalized = canonicalizeMissionScenarioJson(scenarioJson);
  const scenario = parseMissionScenarioJson(normalized);

  await normalizeNpcEmpireKeys(ctx, scenario.npcEmpireKeys);
  for (const config of scenario.empireConfigs) {
    if (config.targetNpcPlayerKey !== null) {
      await normalizeNpcEmpireKeys(ctx, [config.targetNpcPlayerKey]);
    }
    if (config.strategyLibraryKey !== null) {
      const strategy = await getAutomationStrategyByKey(ctx, config.strategyLibraryKey);
      if (strategy === null) {
        throw new Error(`Mission strategy ${config.strategyLibraryKey} was not found.`);
      }
    }
  }

  return normalized;
}

async function assertNpcStrategyKey(
  ctx: MutationCtx,
  strategyLibraryKey: string | null | undefined,
): Promise<string | null> {
  if (strategyLibraryKey === undefined) {
    return null;
  }
  if (strategyLibraryKey === null || strategyLibraryKey.trim().length === 0) {
    return null;
  }
  const strategyKey = normalizeStrategyKey(strategyLibraryKey);
  const strategy = await getAutomationStrategyByKey(ctx, strategyKey);
  if (strategy === null) {
    throw new Error("Selected strategy not found.");
  }
  if (!strategy.availableForNpcs) {
    throw new Error("Selected strategy is not available to NPC players.");
  }
  return strategyKey;
}

async function assertAssignableContentOwner(
  ctx: MutationCtx,
  ownerUserId: Id<"users"> | null,
): Promise<Id<"users"> | null> {
  if (ownerUserId === null) {
    return null;
  }

  const owner = await ctx.db.get("users", ownerUserId);
  if (owner === null) {
    throw new Error("Owner user not found.");
  }
  if (!(owner.admin ?? false) && !(owner.publisher ?? false)) {
    throw new Error("Owner must have publisher or admin rights.");
  }
  return ownerUserId;
}

async function recordModerationEvent(
  ctx: MutationCtx,
  args: {
    contentType: "mission" | "strategy";
    contentKey: string;
    actorUserId: Id<"users">;
    action: "created" | "updated" | "bulk_status_updated" | "bulk_owner_updated" | "bulk_source_updated";
    summary: string;
    note?: string;
  },
) {
  const note = normalizeModerationNote(args.note);
  await ctx.db.insert("admin_content_moderation_events", {
    contentType: args.contentType,
    contentKey: args.contentKey,
    actorUserId: args.actorUserId,
    action: args.action,
    summary: args.summary.trim(),
    note,
    createdAt: Date.now(),
  });
}

async function findPasswordAccountByEmail(ctx: MutationCtx, email: string) {
  return await ctx.db
    .query("authAccounts")
    .withIndex("providerAndAccountId", (q) =>
      q.eq("provider", PASSWORD_PROVIDER_ID).eq("providerAccountId", email),
    )
    .unique();
}

function omitSystemFields<T extends { _id: unknown; _creationTime: number }>(doc: T): Omit<T, "_id" | "_creationTime"> {
  const { _id: _ignoredId, _creationTime: _ignoredCreationTime, ...fields } = doc;
  return fields;
}

export const reseedGame = mutation({
  args: {
    gameId: v.id("sim_games"),
    mapKey: v.string(),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ systems: number; empires: number; mapKey: string }> => {
    const userId = await getAuthUserId(ctx);
    const result: { systems: number; empires: number; mapKey: string } =
      await ctx.runMutation(internal.admin.internal.seedGameData, {
        ...args,
        colorPrefsUserId: userId ?? undefined,
      });
    return result;
  },
});

const settingsValidator = v.object({
  foodProdMult: v.number(),
  shipProdMult: v.number(),
  popGrowthMult: v.number(),
  taxMult: v.number(),
  foodPriceElasticityMult: v.number(),
  starvationMult: v.number(),
  starvationFoodPriceCapMult: v.number(),
  traderShipCostMult: v.number(),
  combatAttackMult: v.number(),
  combatDefendMult: v.number(),
  collateralDamageMult: v.number(),
  shipProdEmphasisPower: v.number(),
  // Balance page fields
  traderMinActive: v.number(),
  traderMaxActive: v.number(),
  traderShipHirePerTurn: v.number(),
  traderHireChancePct: v.number(),
  traderDockingCost: v.number(),
  localTreasuryAddsPer100Cr: v.number(),
  foodStockpileMaxPerPop: v.number(),
  foodStockpileMinPerPop: v.number(),
  foodStressFactor: v.number(),
  combatDefenderAdvantage: v.number(),
  foodBasePrice: v.number(),
  combatFoodDamageMult: v.number(),
  traderLimitsAutomated: v.boolean(),
});

/** Returns the current god-mode settings for a game (or defaults if none set). */
export const getGameSettings = query({
  args: { gameId: v.id("sim_games") },
  handler: async (ctx, args) => {
    const settings = await loadGameSettings(ctx, args.gameId);
    const game = await loadGameWithResolvedMode(ctx, args.gameId);
    if (game === null || gameUsesTraderEconomy(game)) {
      return settings;
    }
    return withTraderSettingsReset(settings);
  },
});

/**
 * Upserts the god-mode multipliers for a game. Admin-only.
 * All values are clamped server-side to safe ranges before saving.
 */
export const updateGameSettings = mutation({
  args: {
    gameId: v.id("sim_games"),
    settings: settingsValidator,
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Authentication required.");
    await assertGameAdmin(ctx, args.gameId, userId);
    const game = await loadGameWithPersistedResolvedMode(ctx, args.gameId);
    if (game === null) throw new Error("Game not found.");

    function clamp(v: number, lo: number, hi: number) {
      return Math.min(hi, Math.max(lo, v));
    }

    const s = args.settings;
    const safeBase = {
      gameId: args.gameId,
      foodProdMult: clamp(s.foodProdMult, 0.1, 8),
      shipProdMult: clamp(s.shipProdMult, 0.1, 8),
      popGrowthMult: clamp(s.popGrowthMult, 0, 10),
      taxMult: clamp(s.taxMult, 0, 5),
      foodPriceElasticityMult: clamp(s.foodPriceElasticityMult, 0.1, 8),
      starvationMult: clamp(s.starvationMult, 0, 10),
      starvationFoodPriceCapMult: clamp(s.starvationFoodPriceCapMult, 5, 100),
      traderShipCostMult: clamp(s.traderShipCostMult, 0.05, 10),
      combatAttackMult: clamp(s.combatAttackMult, 0.1, 8),
      combatDefendMult: clamp(s.combatDefendMult, 0.1, 8),
      collateralDamageMult: clamp(s.collateralDamageMult, 0, 10),
      shipProdEmphasisPower: clamp(s.shipProdEmphasisPower, 1, 3),
      traderMinActive: clamp(Math.round(s.traderMinActive), 0, 32),
      traderMaxActive: clamp(Math.round(s.traderMaxActive), 0, 64),
      traderShipHirePerTurn: clamp(s.traderShipHirePerTurn, 0, 10_000),
      traderHireChancePct: clamp(Math.round(s.traderHireChancePct), 0, 100),
      traderDockingCost: clamp(s.traderDockingCost, 0, 5_000),
      localTreasuryAddsPer100Cr: clamp(Math.round(s.localTreasuryAddsPer100Cr), 0, 100),
      foodStockpileMaxPerPop: clamp(s.foodStockpileMaxPerPop, 1, 50),
      foodStockpileMinPerPop: clamp(s.foodStockpileMinPerPop, 0, 5),
      foodStressFactor: clamp(s.foodStressFactor, 0.1, 10),
      combatDefenderAdvantage: clamp(s.combatDefenderAdvantage, 0.5, 9),
      foodBasePrice: clamp(Math.round(s.foodBasePrice), 1, 50),
      combatFoodDamageMult: clamp(s.combatFoodDamageMult, 0, 5),
      traderLimitsAutomated: s.traderLimitsAutomated,
    };
    const safe = gameUsesTraderEconomy(game)
      ? safeBase
      : withTraderSettingsReset(safeBase);

    const existing = await ctx.db
      .query("sim_game_settings")
      .withIndex("by_gameId", (q) => q.eq("gameId", args.gameId))
      .unique();

    if (existing === null) {
      await ctx.db.insert("sim_game_settings", safe);
    } else {
      await ctx.db.patch("sim_game_settings", existing._id, safe);
    }
  },
});

/** Resets all god-mode multipliers to 1.0 for a game. Admin-only. */
export const resetGameSettings = mutation({
  args: { gameId: v.id("sim_games") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Authentication required.");
    await assertGameAdmin(ctx, args.gameId, userId);

    const existing = await ctx.db
      .query("sim_game_settings")
      .withIndex("by_gameId", (q) => q.eq("gameId", args.gameId))
      .unique();

    if (existing !== null) {
      await ctx.db.patch("sim_game_settings", existing._id, {
        ...DEFAULT_GAME_SETTINGS,
      });
    }
  },
});

/**
 * Repairs a live game that has been damaged by the old starvation death-spiral bug.
 * For every empire-owned system:
 *  - Sets stockFood to at least REPAIR_FOOD_FLOOR so the economy can restart.
 *  - Boosts population to at least REPAIR_POP_FLOOR if starvation has depleted it.
 *  - Clears recentDamagePopulation so production penalties reset.
 * Also resets any degraded productionModifier in system holdings back to 1.
 */
export const repairGameEconomy = mutation({
  args: { gameId: v.id("sim_games") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Authentication required.");
    await assertGameAdmin(ctx, args.gameId, userId);

    const REPAIR_FOOD_FLOOR = 2_400;
    const REPAIR_POP_FLOOR = 1_000_000;

    const systems = await ctx.db
      .query("gal_systems")
      .withIndex("by_gameId", (q) => q.eq("gameId", args.gameId))
      .collect();

    let repairedSystems = 0;
    for (const system of systems) {
      if (system.ownerEmpireId === null) continue;
      const pop = system.population ?? 0;
      await ctx.db.patch("gal_systems", system._id, {
        stockFood: Math.max(system.stockFood ?? 0, REPAIR_FOOD_FLOOR),
        population: Math.max(pop, REPAIR_POP_FLOOR),
        recentDamagePopulation: 0,
      });
      repairedSystems++;
    }

    const empires = await ctx.db
      .query("emp_states")
      .withIndex("by_gameId", (q) => q.eq("gameId", args.gameId))
      .collect();

    let repairedHoldings = 0;
    for (const empire of empires) {
      const holdings = await ctx.db
        .query("emp_system_holdings")
        .withIndex("by_gameId_and_empireId", (q) =>
          q.eq("gameId", args.gameId).eq("empireId", empire._id),
        )
        .collect();
      for (const holding of holdings) {
        if ((holding.productionModifier ?? 1) < 1) {
          await ctx.db.patch("emp_system_holdings", holding._id, {
            productionModifier: 1,
            unrest: 0.05,
          });
          repairedHoldings++;
        }
      }
    }

    return { repairedSystems, repairedHoldings };
  },
});

export const killGame = mutation({
  args: { gameId: v.id("sim_games") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      throw new Error("Authentication required.");
    }
    await assertGameAdmin(ctx, args.gameId, userId);

    if ((await ctx.db.get("sim_games", args.gameId)) === null) {
      throw new Error("Game not found.");
    }
    await ctx.db.patch("sim_games", args.gameId, {
      status: "finished",
      endedAt: Date.now(),
    });

    await ctx.scheduler.runAfter(0, internal.admin.internal.continueWipeGame, {
      gameId: args.gameId,
      phaseIndex: 0,
    });

    return { deleting: true as const };
  },
});

export const forceRetryTurnResolution = mutation({
  args: { gameId: v.id("sim_games") },
  handler: async (
    ctx,
    args,
  ): Promise<{ started: boolean; turnNumber: number; alreadyResolving: boolean }> => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      throw new Error("Authentication required.");
    }
    await assertGameAdmin(ctx, args.gameId, userId);

    await ctx.runMutation(internal.sim.internal.prepareTurnResolutionRetry, {
      gameId: args.gameId,
    });

    const committed: {
      skipped: boolean;
      committed: boolean;
      resolvedTurn: number;
      nextTurn: number;
    } = await ctx.runMutation(internal.sim.internal.commitPreparedTurn, {
      gameId: args.gameId,
    });
    if (committed.committed) {
      return {
        started: true,
        turnNumber: committed.nextTurn,
        alreadyResolving: false,
      };
    }

    const begin: {
      started: boolean;
      turnNumber: number;
      alreadyResolving: boolean;
    } = await ctx.runMutation(internal.sim.internal.beginTurnResolution, {
      gameId: args.gameId,
    });

    if (begin.started) {
      await ctx.scheduler.runAfter(0, internal.sim.actions.resolveTurnJob, {
        gameId: args.gameId,
        turnNumber: begin.turnNumber,
      });
    }

    return begin;
  },
});

export const finalizeGameByScore = mutation({
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

    return await evaluateGameFinalization(ctx, {
      gameId: args.gameId,
      forceFinishReason: "admin_terminated_scored",
    });
  },
});

export const setGameRetentionClass = mutation({
  args: {
    gameId: v.id("sim_games"),
    retentionClass: v.union(
      v.literal("discarded"),
      v.literal("official"),
      v.literal("archived_debug"),
    ),
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
    if (game.finalizationState === "pending_cleanup" || game.finalizationState === "cleaned") {
      throw new Error("Cannot change retention after cleanup has started.");
    }

    await ctx.db.patch("sim_games", args.gameId, {
      retentionClass: args.retentionClass,
      finalizationState:
        game.finalizationState === undefined ? "none" : game.finalizationState,
    });

    return { retentionClass: args.retentionClass };
  },
});

export const retireGameForCleanup = mutation({
  args: { gameId: v.id("sim_games") },
  handler: async (
    ctx,
    args,
  ): Promise<{
    finalized: boolean;
    finishReason: "last_empire_standing" | "abandoned_scored" | "admin_terminated_discarded" | "admin_terminated_scored" | null;
    requeuedCleanup: boolean;
  }> => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      throw new Error("Authentication required.");
    }
    await assertGameAdmin(ctx, args.gameId, userId);

    const game = await ctx.db.get("sim_games", args.gameId);
    if (game === null) {
      throw new Error("Game not found.");
    }

    // Strong admin path: preserve a durable summary, then remove the live simulation payload.
    if (game.retentionClass !== "official") {
      await ctx.db.patch("sim_games", args.gameId, {
        retentionClass: "official",
      });
    }

    const finalization = await evaluateGameFinalization(ctx, {
      gameId: args.gameId,
      forceFinishReason: "admin_terminated_scored",
    });

    const refreshedGame = await ctx.db.get("sim_games", args.gameId);
    if (refreshedGame === null) {
      return {
        finalized: finalization.finalized,
        finishReason: finalization.finishReason,
        requeuedCleanup: false,
      };
    }

    const shouldQueueCleanup =
      refreshedGame.retentionClass === "official" &&
      (
        refreshedGame.finalizationState === "results_written" ||
        refreshedGame.finalizationState === "pending_cleanup" ||
        refreshedGame.finalizationState === "cleaned"
      );

    if (!shouldQueueCleanup) {
      return {
        finalized: finalization.finalized,
        finishReason: finalization.finishReason,
        requeuedCleanup: false,
      };
    }

    const now = Date.now();
    await ctx.db.patch("sim_games", args.gameId, {
      cleanupQueuedAt: now,
      finalizationState: "pending_cleanup",
    });
    await ctx.scheduler.runAfter(0, internal.admin.internal.continueWipeGame, {
      gameId: args.gameId,
      phaseIndex: 0,
    });

    return {
      finalized: finalization.finalized,
      finishReason: finalization.finishReason,
      requeuedCleanup: true,
    };
  },
});

export const createUser = mutation({
  args: {
    name: v.optional(v.union(v.string(), v.null())),
    email: v.optional(v.union(v.string(), v.null())),
    phone: v.optional(v.union(v.string(), v.null())),
    image: v.optional(v.union(v.string(), v.null())),
    plan: v.optional(v.union(v.literal("free"), v.literal("pro"))),
    password: v.optional(v.union(v.string(), v.null())),
    isAnonymous: v.boolean(),
    admin: v.boolean(),
    publisher: v.boolean(),
    emailVerified: v.boolean(),
    phoneVerified: v.boolean(),
  },
  handler: async (ctx, args): Promise<{ userId: Id<"users"> }> => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      throw new Error("Authentication required.");
    }
    const name = normalizeOptionalUserField(args.name);
    const email = normalizeOptionalUserField(args.email)?.toLowerCase();
    const phone = normalizeOptionalUserField(args.phone);
    const image = normalizeOptionalUserField(args.image);
    const password = normalizeOptionalPassword(args.password);
    const now = Date.now();

    if (args.emailVerified && email === undefined) {
      throw new Error("Email verification requires an email address.");
    }
    if (args.phoneVerified && phone === undefined) {
      throw new Error("Phone verification requires a phone number.");
    }
    if (password !== undefined && email === undefined) {
      throw new Error("Password sign-in requires an email address.");
    }
    if (email !== undefined && password !== undefined) {
      const existingPasswordAccount = await findPasswordAccountByEmail(ctx, email);
      if (existingPasswordAccount !== null) {
        throw new Error("That email already has a password sign-in account.");
      }
    }

    const createdUserId = await ctx.db.insert("users", {
      ...(name !== undefined ? { name } : {}),
      ...(email !== undefined ? { email } : {}),
      ...(phone !== undefined ? { phone } : {}),
      ...(image !== undefined ? { image } : {}),
      ...(args.plan !== undefined ? { plan: args.plan } : {}),
      ...(args.emailVerified ? { emailVerificationTime: now } : {}),
      ...(args.phoneVerified ? { phoneVerificationTime: now } : {}),
      ...(args.isAnonymous ? { isAnonymous: true } : {}),
      ...(args.admin ? { admin: true } : {}),
      ...(args.publisher ? { publisher: true } : {}),
    });

    if (email !== undefined && password !== undefined) {
      await ctx.db.insert("authAccounts", {
        userId: createdUserId,
        provider: PASSWORD_PROVIDER_ID,
        providerAccountId: email,
        secret: await new Scrypt().hash(password),
        ...(args.emailVerified ? { emailVerified: email } : {}),
      });
    }

    return {
      userId: createdUserId,
    };
  },
});

export const updateUser = mutation({
  args: {
    userId: v.id("users"),
    name: v.optional(v.union(v.string(), v.null())),
    email: v.optional(v.union(v.string(), v.null())),
    phone: v.optional(v.union(v.string(), v.null())),
    image: v.optional(v.union(v.string(), v.null())),
    plan: v.union(v.literal("free"), v.literal("pro")),
    isAnonymous: v.boolean(),
    admin: v.boolean(),
    publisher: v.boolean(),
    emailVerified: v.boolean(),
    phoneVerified: v.boolean(),
  },
  handler: async (ctx, args): Promise<{ userId: Id<"users"> }> => {
    const viewerUserId = await getAuthUserId(ctx);
    if (viewerUserId === null) {
      throw new Error("Authentication required.");
    }

    const user = await ctx.db.get("users", args.userId);
    if (user === null) {
      throw new Error("User not found.");
    }

    const name = normalizeOptionalUserField(args.name);
    const email = normalizeOptionalUserField(args.email)?.toLowerCase();
    const phone = normalizeOptionalUserField(args.phone);
    const image = normalizeOptionalUserField(args.image);
    const now = Date.now();

    if (args.emailVerified && email === undefined) {
      throw new Error("Email verification requires an email address.");
    }
    if (args.phoneVerified && phone === undefined) {
      throw new Error("Phone verification requires a phone number.");
    }

    const passwordAccount = await ctx.db
      .query("authAccounts")
      .withIndex("userIdAndProvider", (q) => q.eq("userId", args.userId).eq("provider", PASSWORD_PROVIDER_ID))
      .unique();

    if (passwordAccount !== null && email === undefined) {
      throw new Error("Users with password sign-in must keep an email address.");
    }

    if (email !== undefined) {
      const existingPasswordAccount = await findPasswordAccountByEmail(ctx, email);
      if (existingPasswordAccount !== null && existingPasswordAccount.userId !== args.userId) {
        throw new Error("That email already belongs to another password sign-in account.");
      }
    }

    const nextUser = omitSystemFields(user);

    if (name === undefined) {
      delete nextUser.name;
    } else {
      nextUser.name = name;
    }

    if (email === undefined) {
      delete nextUser.email;
    } else {
      nextUser.email = email;
    }

    if (phone === undefined) {
      delete nextUser.phone;
    } else {
      nextUser.phone = phone;
    }

    if (image === undefined) {
      delete nextUser.image;
    } else {
      nextUser.image = image;
    }

    nextUser.plan = args.plan;

    if (args.emailVerified) {
      nextUser.emailVerificationTime = user.emailVerificationTime ?? now;
    } else {
      delete nextUser.emailVerificationTime;
    }

    if (args.phoneVerified) {
      nextUser.phoneVerificationTime = user.phoneVerificationTime ?? now;
    } else {
      delete nextUser.phoneVerificationTime;
    }

    if (args.isAnonymous) {
      nextUser.isAnonymous = true;
    } else {
      delete nextUser.isAnonymous;
    }

    if (args.admin) {
      nextUser.admin = true;
    } else {
      delete nextUser.admin;
    }

    if (args.publisher) {
      nextUser.publisher = true;
    } else {
      delete nextUser.publisher;
    }

    await ctx.db.replace("users", args.userId, nextUser);

    if (passwordAccount !== null && email !== undefined) {
      const nextPasswordAccount = omitSystemFields(passwordAccount);
      nextPasswordAccount.providerAccountId = email;
      if (nextUser.emailVerificationTime !== undefined) {
        nextPasswordAccount.emailVerified = email;
      } else {
        delete nextPasswordAccount.emailVerified;
      }
      await ctx.db.replace("authAccounts", passwordAccount._id, nextPasswordAccount);
    }

    return { userId: args.userId };
  },
});

export const setUserPassword = mutation({
  args: {
    userId: v.id("users"),
    password: v.string(),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ userId: Id<"users">; createdAccount: boolean }> => {
    const viewerUserId = await getAuthUserId(ctx);
    if (viewerUserId === null) {
      throw new Error("Authentication required.");
    }

    const user = await ctx.db.get("users", args.userId);
    if (user === null) {
      throw new Error("User not found.");
    }

    const email = normalizeOptionalUserField(user.email)?.toLowerCase();
    if (email === undefined) {
      throw new Error("Password sign-in requires the user to have an email address.");
    }

    const password = normalizeOptionalPassword(args.password);
    if (password === undefined) {
      throw new Error("Password must be at least 8 characters.");
    }

    const existingPasswordAccount = await findPasswordAccountByEmail(ctx, email);
    const secret = await new Scrypt().hash(password);

    if (existingPasswordAccount === null) {
      await ctx.db.insert("authAccounts", {
        userId: user._id,
        provider: PASSWORD_PROVIDER_ID,
        providerAccountId: email,
        secret,
        ...(user.emailVerificationTime !== undefined ? { emailVerified: email } : {}),
      });
      return { userId: user._id, createdAccount: true };
    }

    if (existingPasswordAccount.userId !== user._id) {
      throw new Error("That email already belongs to another password sign-in account.");
    }

    await ctx.db.patch("authAccounts", existingPasswordAccount._id, {
      secret,
      ...(user.emailVerificationTime !== undefined ? { emailVerified: email } : {}),
    });
    return { userId: user._id, createdAccount: false };
  },
});

export const deleteUser = mutation({
  args: {
    userId: v.id("users"),
  },
  handler: async (ctx, args): Promise<{ deletedUserId: Id<"users"> }> => {
    const viewerUserId = await getAuthUserId(ctx);
    if (viewerUserId === null) {
      throw new Error("Authentication required.");
    }

    const user = await ctx.db.get("users", args.userId);
    if (user === null) {
      throw new Error("User not found.");
    }

    const profile = await ctx.db
      .query("usr_profiles")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .unique();
    if (profile !== null) {
      await ctx.db.delete("usr_profiles", profile._id);
    }

    const automationProfiles = await ctx.db
      .query("usr_automation_profiles")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .take(128);
    for (const automationProfile of automationProfiles) {
      await ctx.db.delete("usr_automation_profiles", automationProfile._id);
    }

    const colorPrefs = await ctx.db
      .query("usr_empire_color_prefs")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .take(128);
    for (const colorPref of colorPrefs) {
      await ctx.db.delete("usr_empire_color_prefs", colorPref._id);
    }

    const authAccounts = await ctx.db
      .query("authAccounts")
      .withIndex("userIdAndProvider", (q) => q.eq("userId", args.userId))
      .take(32);
    for (const authAccount of authAccounts) {
      const verificationCodes = await ctx.db
        .query("authVerificationCodes")
        .withIndex("accountId", (q) => q.eq("accountId", authAccount._id))
        .take(64);
      for (const verificationCode of verificationCodes) {
        await ctx.db.delete("authVerificationCodes", verificationCode._id);
      }
      await ctx.db.delete("authAccounts", authAccount._id);
    }

    const authSessions = await ctx.db
      .query("authSessions")
      .withIndex("userId", (q) => q.eq("userId", args.userId))
      .take(64);
    for (const authSession of authSessions) {
      const refreshTokens = await ctx.db
        .query("authRefreshTokens")
        .withIndex("sessionId", (q) => q.eq("sessionId", authSession._id))
        .take(128);
      for (const refreshToken of refreshTokens) {
        await ctx.db.delete("authRefreshTokens", refreshToken._id);
      }
      await ctx.db.delete("authSessions", authSession._id);
    }

    const gameRoles = await ctx.db
      .query("usr_game_roles")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .take(128);
    for (const gameRole of gameRoles) {
      await ctx.db.delete("usr_game_roles", gameRole._id);
    }

    await ctx.db.delete("users", args.userId);

    return {
      deletedUserId: args.userId,
    };
  },
});

export const runLegacyGameCleanupBatch = mutation({
  args: {
    limit: v.optional(v.number()),
    includeFinished: v.optional(v.boolean()),
    includeInactive: v.optional(v.boolean()),
    defaultRetentionClass: v.optional(
      v.union(
        v.literal("discarded"),
        v.literal("official"),
        v.literal("archived_debug"),
      ),
    ),
  },
  handler: async (ctx, args) => {
    const viewerUserId = await getAuthUserId(ctx);
    if (viewerUserId === null) {
      throw new Error("Authentication required.");
    }

    const limit = Math.max(1, Math.min(Math.floor(args.limit ?? 16), 64));
    const scanLimit = Math.max(limit, limit * LEGACY_GAME_CLEANUP_SCAN_MULTIPLIER);
    const includeFinished = args.includeFinished ?? true;
    const includeInactive = args.includeInactive ?? true;
    const defaultRetentionClass = args.defaultRetentionClass ?? "official";

    const candidates: Array<{
      _id: Id<"sim_games">;
      status: "lobby" | "running" | "paused" | "finished";
      retentionClass?: "discarded" | "official" | "archived_debug";
      finalizationState?:
        | "none"
        | "pending_result_write"
        | "results_written"
        | "pending_cleanup"
        | "cleaned"
        | "archived_debug";
    }> = [];

    if (includeFinished) {
      const finished = await ctx.db
        .query("sim_games")
        .withIndex("by_status", (q) => q.eq("status", "finished"))
        .take(scanLimit);
      candidates.push(...finished);
    }

    if (includeInactive) {
      for (const status of ["running", "paused"] as const) {
        const rows = await ctx.db
          .query("sim_games")
          .withIndex("by_status", (q) => q.eq("status", status))
          .take(scanLimit);
        candidates.push(...rows);
      }
    }

    const processedGameIds: Id<"sim_games">[] = [];
    let finalized = 0;

    for (const game of candidates) {
      if (processedGameIds.length >= limit) {
        break;
      }
      if (
        game.finalizationState === "pending_cleanup" ||
        game.finalizationState === "cleaned" ||
        game.finalizationState === "archived_debug"
      ) {
        continue;
      }

      if (game.retentionClass === undefined) {
        await ctx.db.patch("sim_games", game._id, {
          retentionClass: defaultRetentionClass,
        });
      }

      const result = await evaluateGameFinalization(ctx, { gameId: game._id });
      processedGameIds.push(game._id);
      if (result.finalized) {
        finalized += 1;
      }
    }

    return {
      processed: processedGameIds.length,
      finalized,
      limit,
      processedGameIds,
    };
  },
});

export const backfillGameUrlCodes = mutation({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const viewerUserId = await getAuthUserId(ctx);
    if (viewerUserId === null) {
      throw new Error("Authentication required.");
    }

    const limit = Math.max(1, Math.min(Math.floor(args.limit ?? 64), 128));
    const games = await ctx.db.query("sim_games").order("desc").take(limit * 4);

    let updated = 0;
    const updatedGameIds: Id<"sim_games">[] = [];

    for (const game of games) {
      if (updated >= limit) {
        break;
      }
      if (!gameUrlCodeNeedsRefresh(game.urlCode)) {
        continue;
      }

      const urlCode = await createUniqueGameUrlCode(ctx);
      await ctx.db.patch("sim_games", game._id, { urlCode });
      updated += 1;
      updatedGameIds.push(game._id);
    }

    return {
      scanned: games.length,
      updated,
      updatedGameIds,
    };
  },
});

export const backfillMetadataAccessBatch = mutation({
  args: {
    limit: v.optional(v.number()),
    userCursor: v.optional(v.string()),
    missionCursor: v.optional(v.string()),
    strategyCursor: v.optional(v.string()),
    gameCursor: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const viewerUserId = await getAuthUserId(ctx);
    if (viewerUserId === null) {
      throw new Error("Authentication required.");
    }

    const limit = Math.max(1, Math.min(Math.floor(args.limit ?? 32), 128));
    let updatedUsers = 0;
    let updatedGames = 0;
    let updatedMissions = 0;
    let updatedStrategies = 0;
    let scannedUsers = 0;
    let scannedGames = 0;
    let scannedMissions = 0;
    let scannedStrategies = 0;
    let missionBackedGameModes = 0;
    let fallbackGameModes = 0;

    const updatedUserIds: Id<"users">[] = [];
    const updatedGameIds: Id<"sim_games">[] = [];
    const updatedMissionIds: Id<"sim_missions">[] = [];
    const updatedStrategyIds: Id<"usr_automation_strategies">[] = [];

    const usersPage = await ctx.db.query("users").order("desc").paginate({
      cursor: args.userCursor ?? null,
      numItems: limit,
    });
    scannedUsers = usersPage.page.length;
    for (const user of usersPage.page) {
      const patch: {
        plan?: "free";
        publisher?: false;
      } = {};
      if (user.plan === undefined) {
        patch.plan = "free";
      }
      if (user.publisher === undefined) {
        patch.publisher = false;
      }
      if (Object.keys(patch).length === 0) {
        continue;
      }
      await ctx.db.patch("users", user._id, patch);
      updatedUsers += 1;
      updatedUserIds.push(user._id);
    }

    const missionsPage = await ctx.db.query("sim_missions").order("desc").paginate({
      cursor: args.missionCursor ?? null,
      numItems: limit,
    });
    scannedMissions = missionsPage.page.length;
    for (const mission of missionsPage.page) {
      const patch: {
        ownerUserId?: null;
        source?: "official";
        reviewStatus?: "unreviewed" | "needs_changes" | "approved";
        status?: "draft" | "published" | "archived" | "deleted" | "admin_deleted";
        mode?: "conquest_core" | "conquest_plus" | "trader_economy";
        requiredTier?: "free" | "pro";
      } = {};
      if (mission.ownerUserId === undefined) {
        patch.ownerUserId = null;
      }
      if (mission.source === undefined) {
        patch.source = "official";
      }
      if (mission.reviewStatus === undefined) {
        patch.reviewStatus = resolvePublisherContentReviewStatus({
          source: mission.source,
          reviewStatus: undefined,
        });
      }
      if (mission.status === undefined) {
        patch.status = resolvePublisherContentStatus({
          status: undefined,
          published: mission.published,
          defaultDraft: true,
        });
      }
      if (mission.mode === undefined) {
        patch.mode = "conquest_core";
      }
      if (mission.requiredTier === undefined) {
        patch.requiredTier = "free";
      }
      if (Object.keys(patch).length === 0) {
        continue;
      }
      await ctx.db.patch("sim_missions", mission._id, patch);
      updatedMissions += 1;
      updatedMissionIds.push(mission._id);
    }

    const strategiesPage = await ctx.db.query("usr_automation_strategies").order("desc").paginate({
      cursor: args.strategyCursor ?? null,
      numItems: limit,
    });
    scannedStrategies = strategiesPage.page.length;
    for (const strategy of strategiesPage.page) {
      const patch: {
        ownerUserId?: null;
        source?: "official";
        reviewStatus?: "unreviewed" | "needs_changes" | "approved";
        status?: "published";
      } = {};
      if (strategy.ownerUserId === undefined) {
        patch.ownerUserId = null;
      }
      if (strategy.source === undefined) {
        patch.source = "official";
      }
      if (strategy.reviewStatus === undefined) {
        patch.reviewStatus = resolvePublisherContentReviewStatus({
          source: strategy.source,
          reviewStatus: undefined,
        });
      }
      if (strategy.status === undefined) {
        patch.status = "published";
      }
      if (Object.keys(patch).length === 0) {
        continue;
      }
      await ctx.db.patch("usr_automation_strategies", strategy._id, patch);
      updatedStrategies += 1;
      updatedStrategyIds.push(strategy._id);
    }

    const gamesPage = await ctx.db.query("sim_games").order("desc").paginate({
      cursor: args.gameCursor ?? null,
      numItems: limit,
    });
    scannedGames = gamesPage.page.length;
    for (const game of gamesPage.page) {
      if (game.mode !== undefined) {
        continue;
      }
      const missionKey = game.missionKey ?? game.lobbyScenarioKey ?? undefined;
      const mission = missionKey === undefined || missionKey === null ? null : await getMissionByKey(ctx, missionKey);
      const mode = mission?.mode ?? "trader_economy";
      await ctx.db.patch("sim_games", game._id, { mode });
      updatedGames += 1;
      updatedGameIds.push(game._id);
      if (mission !== null) {
        missionBackedGameModes += 1;
      } else {
        fallbackGameModes += 1;
      }
    }

    return {
      limit,
      scannedUsers,
      scannedGames,
      scannedMissions,
      scannedStrategies,
      updatedUsers,
      updatedGames,
      updatedMissions,
      updatedStrategies,
      missionBackedGameModes,
      fallbackGameModes,
      updatedUserIds,
      updatedGameIds,
      updatedMissionIds,
      updatedStrategyIds,
      nextUserCursor: usersPage.isDone ? null : usersPage.continueCursor,
      nextMissionCursor: missionsPage.isDone ? null : missionsPage.continueCursor,
      nextStrategyCursor: strategiesPage.isDone ? null : strategiesPage.continueCursor,
      nextGameCursor: gamesPage.isDone ? null : gamesPage.continueCursor,
      sweepComplete: usersPage.isDone && missionsPage.isDone && strategiesPage.isDone && gamesPage.isDone,
    };
  },
});

export const createAutomationStrategy = mutation({
  args: {
    key: v.string(),
    name: v.string(),
    description: v.string(),
    tags: v.array(v.string()),
    strategyJson: v.string(),
    ownerUserId: v.optional(v.union(v.id("users"), v.null())),
    source: v.optional(v.union(v.literal("official"), v.literal("community"))),
    reviewStatus: v.optional(
      v.union(v.literal("unreviewed"), v.literal("needs_changes"), v.literal("approved")),
    ),
    status: v.optional(v.union(v.literal("draft"), v.literal("published"))),
    availableForHumans: v.boolean(),
    availableForNpcs: v.boolean(),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      throw new Error("Authentication required.");
    }

    const key = normalizeStrategyKey(args.key);
    const existing = await getAutomationStrategyByKey(ctx, key);
    if (existing !== null) {
      throw new Error("That strategy key already exists.");
    }

    const now = Date.now();
    const source = args.source ?? "official";
    const status = args.status ?? (source === "community" ? "draft" : "published");
    const reviewStatus = resolvePublisherContentReviewStatus({
      source,
      reviewStatus: args.reviewStatus,
    });
    const ownerUserId = await assertAssignableContentOwner(ctx, args.ownerUserId ?? null);
    if (source === "official" && ownerUserId !== null) {
      throw new Error("Official strategies cannot have an owner.");
    }
    const strategyId = await ctx.db.insert("usr_automation_strategies", {
      key,
      name: args.name.trim(),
      description: normalizeStrategyDescription(args.description),
      tags: normalizeStrategyTags(args.tags),
      strategyJson: canonicalizeStrategyJson(args.strategyJson),
      ownerUserId,
      source,
      reviewStatus,
      status,
      availableForHumans: args.availableForHumans,
      availableForNpcs: args.availableForNpcs,
      createdAt: now,
      updatedAt: now,
    });
    await recordModerationEvent(ctx, {
      contentType: "strategy",
      contentKey: key,
      actorUserId: userId,
      action: "created",
      summary: `Created ${source} strategy with ${status} status.`,
    });
    return strategyId;
  },
});

export const updateAutomationStrategy = mutation({
  args: {
    key: v.string(),
    name: v.optional(v.string()),
    description: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
    strategyJson: v.optional(v.string()),
    ownerUserId: v.optional(v.union(v.id("users"), v.null())),
    source: v.optional(v.union(v.literal("official"), v.literal("community"))),
    reviewStatus: v.optional(
      v.union(v.literal("unreviewed"), v.literal("needs_changes"), v.literal("approved")),
    ),
    status: v.optional(
      v.union(
        v.literal("draft"),
        v.literal("published"),
        v.literal("archived"),
        v.literal("deleted"),
        v.literal("admin_deleted"),
      ),
    ),
    moderationNote: v.optional(v.string()),
    availableForHumans: v.optional(v.boolean()),
    availableForNpcs: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      throw new Error("Authentication required.");
    }

    const key = normalizeStrategyKey(args.key);
    const existing = await getAutomationStrategyByKey(ctx, key);
    if (existing === null) {
      throw new Error("Strategy not found.");
    }

    const currentStatus = resolvePublisherContentStatus({ status: existing.status });
    if (isTerminalContentStatus(currentStatus)) {
      throw new Error("This content is in a terminal status and can no longer be edited.");
    }
    assertMayTransitionContentStatus({
      currentStatus,
      nextStatus: args.status ?? currentStatus,
      isAdmin: true,
    });

    const patch: {
      name?: string;
      description?: string;
      tags?: string[];
      strategyJson?: string;
      source?: "official" | "community";
      reviewStatus?: "unreviewed" | "needs_changes" | "approved";
      status?: "draft" | "published" | "archived" | "deleted" | "admin_deleted";
      availableForHumans?: boolean;
      availableForNpcs?: boolean;
      ownerUserId?: Id<"users"> | null;
      updatedAt: number;
    } = { updatedAt: Date.now() };

    if (args.name !== undefined) {
      patch.name = args.name.trim();
    }
    if (args.description !== undefined) {
      patch.description = normalizeStrategyDescription(args.description);
    }
    if (args.tags !== undefined) {
      patch.tags = normalizeStrategyTags(args.tags);
    }
    if (args.strategyJson !== undefined) {
      patch.strategyJson = canonicalizeStrategyJson(args.strategyJson);
    }
    if (args.ownerUserId !== undefined) {
      patch.ownerUserId = await assertAssignableContentOwner(ctx, args.ownerUserId);
    }
    if (args.source !== undefined) {
      patch.source = args.source;
    }
    if (args.reviewStatus !== undefined) {
      patch.reviewStatus = args.reviewStatus;
    }
    if (args.status !== undefined) {
      patch.status = args.status;
    }
    if (args.availableForHumans !== undefined) {
      patch.availableForHumans = args.availableForHumans;
    }
    if (args.availableForNpcs !== undefined) {
      patch.availableForNpcs = args.availableForNpcs;
    }
    if ((patch.source ?? existing.source ?? "official") === "official") {
      patch.ownerUserId = null;
      patch.reviewStatus = "approved";
    }

    if (existing.ownerUserId === undefined) {
      patch.ownerUserId = patch.ownerUserId ?? null;
    }
    if (existing.source === undefined) {
      (patch as { source?: "official" }).source = "official";
    }
    if (existing.reviewStatus === undefined) {
      patch.reviewStatus = patch.reviewStatus ?? resolvePublisherContentReviewStatus({
        source: patch.source ?? existing.source,
        reviewStatus: existing.reviewStatus,
      });
    }
    if (existing.status === undefined) {
      (patch as { status?: "published" }).status = "published";
    }

    await ctx.db.patch("usr_automation_strategies", existing._id, patch);
    const nextSource = patch.source ?? existing.source ?? "official";
    const nextStatus = patch.status ?? resolvePublisherContentStatus({ status: existing.status });
    const nextOwnerUserId =
      patch.ownerUserId !== undefined
        ? patch.ownerUserId
        : existing.ownerUserId === undefined
          ? null
          : existing.ownerUserId;
    await recordModerationEvent(ctx, {
      contentType: "strategy",
      contentKey: key,
      actorUserId: userId,
      action: "updated",
      summary: `Updated strategy metadata to ${nextSource} / ${nextStatus}${nextOwnerUserId === null ? " / system owner" : " / assigned owner"}.`,
      note: args.moderationNote,
    });
    return { key };
  },
});

export const bulkUpdateAutomationStrategyStatus = mutation({
  args: {
    keys: v.array(v.string()),
    status: v.union(
      v.literal("draft"),
      v.literal("published"),
      v.literal("archived"),
      v.literal("deleted"),
      v.literal("admin_deleted"),
    ),
    moderationNote: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      throw new Error("Authentication required.");
    }

    const keys = normalizeUniqueKeys(args.keys, normalizeStrategyKey);
    const updatedKeys: string[] = [];
    const skippedKeys: string[] = [];

    for (const key of keys) {
      const existing = await getAutomationStrategyByKey(ctx, key);
      if (existing === null) {
        skippedKeys.push(key);
        continue;
      }

      const currentStatus = resolvePublisherContentStatus({ status: existing.status });
      if (isTerminalContentStatus(currentStatus)) {
        skippedKeys.push(key);
        continue;
      }

      try {
        assertMayTransitionContentStatus({
          currentStatus,
          nextStatus: args.status,
          isAdmin: true,
        });
      } catch {
        skippedKeys.push(key);
        continue;
      }

      await ctx.db.patch("usr_automation_strategies", existing._id, {
        status: args.status,
        updatedAt: Date.now(),
      });
      await recordModerationEvent(ctx, {
        contentType: "strategy",
        contentKey: key,
        actorUserId: userId,
        action: "bulk_status_updated",
        summary: `Bulk updated status to ${args.status}.`,
        note: args.moderationNote,
      });
      updatedKeys.push(key);
    }

    return { updatedKeys, skippedKeys };
  },
});

export const bulkUpdateAutomationStrategyOwner = mutation({
  args: {
    keys: v.array(v.string()),
    ownerUserId: v.union(v.id("users"), v.null()),
    moderationNote: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      throw new Error("Authentication required.");
    }

    const keys = normalizeUniqueKeys(args.keys, normalizeStrategyKey);
    const ownerUserId = await assertAssignableContentOwner(ctx, args.ownerUserId);
    const updatedKeys: string[] = [];
    const skippedKeys: string[] = [];

    for (const key of keys) {
      const existing = await getAutomationStrategyByKey(ctx, key);
      if (existing === null) {
        skippedKeys.push(key);
        continue;
      }
      if ((existing.source ?? "official") === "official" && ownerUserId !== null) {
        skippedKeys.push(key);
        continue;
      }

      await ctx.db.patch("usr_automation_strategies", existing._id, {
        ownerUserId,
        updatedAt: Date.now(),
      });
      await recordModerationEvent(ctx, {
        contentType: "strategy",
        contentKey: key,
        actorUserId: userId,
        action: "bulk_owner_updated",
        summary: ownerUserId === null ? "Bulk cleared owner to system." : "Bulk reassigned owner.",
        note: args.moderationNote,
      });
      updatedKeys.push(key);
    }

    return { updatedKeys, skippedKeys };
  },
});

export const bulkUpdateAutomationStrategySource = mutation({
  args: {
    keys: v.array(v.string()),
    source: v.union(v.literal("official"), v.literal("community")),
    moderationNote: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      throw new Error("Authentication required.");
    }

    const keys = normalizeUniqueKeys(args.keys, normalizeStrategyKey);
    const updatedKeys: string[] = [];
    const skippedKeys: string[] = [];

    for (const key of keys) {
      const existing = await getAutomationStrategyByKey(ctx, key);
      if (existing === null) {
        skippedKeys.push(key);
        continue;
      }

      const currentStatus = resolvePublisherContentStatus({ status: existing.status });
      if (isTerminalContentStatus(currentStatus)) {
        skippedKeys.push(key);
        continue;
      }

      await ctx.db.patch("usr_automation_strategies", existing._id, {
        source: args.source,
        reviewStatus:
          args.source === "official"
            ? "approved"
            : resolvePublisherContentReviewStatus({
                source: args.source,
                reviewStatus: existing.reviewStatus,
              }),
        ownerUserId: args.source === "official" ? null : (existing.ownerUserId ?? null),
        updatedAt: Date.now(),
      });
      await recordModerationEvent(ctx, {
        contentType: "strategy",
        contentKey: key,
        actorUserId: userId,
        action: "bulk_source_updated",
        summary:
          args.source === "official"
            ? "Bulk moved source to official and cleared owner."
            : "Bulk moved source to community.",
        note: args.moderationNote,
      });
      updatedKeys.push(key);
    }

    return { updatedKeys, skippedKeys };
  },
});

export const seedMissingAutomationStrategies = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      throw new Error("Authentication required.");
    }

    let inserted = 0;
    let skipped = 0;

    for (const strategy of BUILT_IN_AUTOMATION_STRATEGY_SEED_ROWS) {
      const existing = await getAutomationStrategyByKey(ctx, strategy.key);
      if (existing !== null) {
        skipped += 1;
        continue;
      }

      const now = Date.now();
      await ctx.db.insert("usr_automation_strategies", {
        key: strategy.key,
        name: strategy.name,
        description: strategy.description,
        tags: strategy.tags,
        strategyJson: strategy.strategyJson,
        ownerUserId: null,
        source: "official",
        reviewStatus: "approved",
        status: "published",
        availableForHumans: strategy.availableForHumans,
        availableForNpcs: strategy.availableForNpcs,
        createdAt: now,
        updatedAt: now,
      });
      inserted += 1;
    }

    return { inserted, skipped };
  },
});

export const createEmpireNpcPlayer = mutation({
  args: {
    key: v.string(),
    playerName: v.string(),
    empireName: v.string(),
    colorHex: v.string(),
    strategyLibraryKey: v.union(v.string(), v.null()),
    isActive: v.boolean(),
    sortOrder: v.number(),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      throw new Error("Authentication required.");
    }

    const key = normalizeNpcPlayerKey(args.key);
    const existing = await ctx.db
      .query("emp_npc_players")
      .withIndex("by_key", (q) => q.eq("key", key))
      .unique();
    if (existing !== null) {
      throw new Error("That NPC key already exists.");
    }

    const now = Date.now();
    return await ctx.db.insert("emp_npc_players", {
      key,
      playerName: normalizeNpcPlayerName(args.playerName, "Player name"),
      empireName: normalizeNpcPlayerName(args.empireName, "Empire name"),
      colorHex: normalizeNpcColorHex(args.colorHex),
      strategyLibraryKey: await assertNpcStrategyKey(ctx, args.strategyLibraryKey),
      isActive: args.isActive,
      sortOrder: normalizeNpcSortOrder(args.sortOrder),
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const updateEmpireNpcPlayer = mutation({
  args: {
    key: v.string(),
    playerName: v.optional(v.string()),
    empireName: v.optional(v.string()),
    colorHex: v.optional(v.string()),
    strategyLibraryKey: v.optional(v.union(v.string(), v.null())),
    isActive: v.optional(v.boolean()),
    sortOrder: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      throw new Error("Authentication required.");
    }

    const key = normalizeNpcPlayerKey(args.key);
    const existing = await ctx.db
      .query("emp_npc_players")
      .withIndex("by_key", (q) => q.eq("key", key))
      .unique();
    if (existing === null) {
      throw new Error("NPC player not found.");
    }

    const patch: {
      playerName?: string;
      empireName?: string;
      colorHex?: string;
      strategyLibraryKey?: string | null;
      isActive?: boolean;
      sortOrder?: number;
      updatedAt: number;
    } = { updatedAt: Date.now() };

    if (args.playerName !== undefined) {
      patch.playerName = normalizeNpcPlayerName(args.playerName, "Player name");
    }
    if (args.empireName !== undefined) {
      patch.empireName = normalizeNpcPlayerName(args.empireName, "Empire name");
    }
    if (args.colorHex !== undefined) {
      patch.colorHex = normalizeNpcColorHex(args.colorHex);
    }
    if (args.strategyLibraryKey !== undefined) {
      patch.strategyLibraryKey = await assertNpcStrategyKey(ctx, args.strategyLibraryKey);
    }
    if (args.isActive !== undefined) {
      patch.isActive = args.isActive;
    }
    if (args.sortOrder !== undefined) {
      patch.sortOrder = normalizeNpcSortOrder(args.sortOrder);
    }

    await ctx.db.patch(existing._id, patch);
    return { key };
  },
});

export const seedMissingEmpireNpcPlayers = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      throw new Error("Authentication required.");
    }

    let inserted = 0;
    let skipped = 0;

    for (const player of NPC_EMPIRE_PLAYERS) {
      const existing = await ctx.db
        .query("emp_npc_players")
        .withIndex("by_key", (q) => q.eq("key", player.key))
        .unique();
      if (existing !== null) {
        skipped += 1;
        continue;
      }

      const now = Date.now();
      await ctx.db.insert("emp_npc_players", {
        key: player.key,
        playerName: player.playerName,
        empireName: player.empireName,
        colorHex: player.colorHex,
        strategyLibraryKey: player.strategyLibraryKey,
        isActive: player.isActive,
        sortOrder: player.sortOrder,
        createdAt: now,
        updatedAt: now,
      });
      inserted += 1;
    }

    return { inserted, skipped };
  },
});

export const createMission = mutation({
  args: {
    key: v.string(),
    name: v.string(),
    description: v.string(),
    mapKey: v.string(),
    mode: v.optional(
      v.union(
        v.literal("conquest_core"),
        v.literal("conquest_plus"),
        v.literal("trader_economy"),
      ),
    ),
    ownerUserId: v.optional(v.union(v.id("users"), v.null())),
    source: v.optional(v.union(v.literal("official"), v.literal("community"))),
    reviewStatus: v.optional(
      v.union(v.literal("unreviewed"), v.literal("needs_changes"), v.literal("approved")),
    ),
    status: v.optional(v.union(v.literal("draft"), v.literal("published"))),
    requiredTier: v.optional(v.union(v.literal("free"), v.literal("pro"))),
    level: v.number(),
    requiredWins: v.number(),
    prerequisiteMissionKeys: v.array(v.string()),
    published: v.boolean(),
    sortOrder: v.number(),
    retentionClass: v.union(
      v.literal("discarded"),
      v.literal("official"),
      v.literal("archived_debug"),
    ),
    scenarioJson: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      throw new Error("Authentication required.");
    }

    const key = normalizeMissionKey(args.key);
    const existing = await ctx.db
      .query("sim_missions")
      .withIndex("by_key", (q) => q.eq("key", key))
      .unique();
    if (existing !== null) {
      throw new Error("That mission key already exists.");
    }

    const now = Date.now();
    const source = args.source ?? "official";
    const status = args.status ?? resolvePublisherContentStatus({
      status: undefined,
      published: args.published,
      defaultDraft: source === "community",
    });
    const reviewStatus = resolvePublisherContentReviewStatus({
      source,
      reviewStatus: args.reviewStatus,
    });
    const ownerUserId = await assertAssignableContentOwner(ctx, args.ownerUserId ?? null);
    if (source === "official" && ownerUserId !== null) {
      throw new Error("Official missions cannot have an owner.");
    }
    const missionId = await ctx.db.insert("sim_missions", {
      key,
      name: normalizeMissionName(args.name),
      description: normalizeMissionDescription(args.description),
      mapKey: args.mapKey.trim(),
      ownerUserId,
      source,
      reviewStatus,
      status,
      mode: args.mode ?? "conquest_core",
      requiredTier: args.requiredTier ?? "free",
      level: normalizeMissionLevel(args.level),
      requiredWins: normalizeMissionRequiredWins(args.requiredWins),
      prerequisiteMissionKeys: normalizeMissionPrerequisites(args.prerequisiteMissionKeys),
      published: status === "published",
      sortOrder: normalizeMissionSortOrder(args.sortOrder),
      retentionClass: args.retentionClass,
      scenarioJson: await normalizeMissionScenarioJson(ctx, args.scenarioJson),
      createdAt: now,
      updatedAt: now,
    });
    await recordModerationEvent(ctx, {
      contentType: "mission",
      contentKey: key,
      actorUserId: userId,
      action: "created",
      summary: `Created ${source} mission with ${status} status.`,
    });
    return missionId;
  },
});

export const updateMission = mutation({
  args: {
    key: v.string(),
    name: v.optional(v.string()),
    description: v.optional(v.string()),
    mapKey: v.optional(v.string()),
    mode: v.optional(
      v.union(
        v.literal("conquest_core"),
        v.literal("conquest_plus"),
        v.literal("trader_economy"),
      ),
    ),
    ownerUserId: v.optional(v.union(v.id("users"), v.null())),
    source: v.optional(v.union(v.literal("official"), v.literal("community"))),
    reviewStatus: v.optional(
      v.union(v.literal("unreviewed"), v.literal("needs_changes"), v.literal("approved")),
    ),
    status: v.optional(
      v.union(
        v.literal("draft"),
        v.literal("published"),
        v.literal("archived"),
        v.literal("deleted"),
        v.literal("admin_deleted"),
      ),
    ),
    requiredTier: v.optional(v.union(v.literal("free"), v.literal("pro"))),
    level: v.optional(v.number()),
    requiredWins: v.optional(v.number()),
    prerequisiteMissionKeys: v.optional(v.array(v.string())),
    published: v.optional(v.boolean()),
    sortOrder: v.optional(v.number()),
    retentionClass: v.optional(
      v.union(
        v.literal("discarded"),
        v.literal("official"),
        v.literal("archived_debug"),
      ),
    ),
    scenarioJson: v.optional(v.string()),
    moderationNote: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      throw new Error("Authentication required.");
    }

    const key = normalizeMissionKey(args.key);
    const existing = await ctx.db
      .query("sim_missions")
      .withIndex("by_key", (q) => q.eq("key", key))
      .unique();
    if (existing === null) {
      throw new Error("Mission not found.");
    }

    const currentStatus = resolvePublisherContentStatus({
      status: existing.status,
      published: existing.published,
      defaultDraft: true,
    });
    if (isTerminalContentStatus(currentStatus)) {
      throw new Error("This content is in a terminal status and can no longer be edited.");
    }
    assertMayTransitionContentStatus({
      currentStatus,
      nextStatus: args.status ?? currentStatus,
      isAdmin: true,
    });

    const patch: {
      name?: string;
      description?: string;
      mapKey?: string;
      source?: "official" | "community";
      reviewStatus?: "unreviewed" | "needs_changes" | "approved";
      mode?: "conquest_core" | "conquest_plus" | "trader_economy";
      requiredTier?: "free" | "pro";
      level?: number;
      requiredWins?: number;
      prerequisiteMissionKeys?: string[];
      published?: boolean;
      sortOrder?: number;
      retentionClass?: "discarded" | "official" | "archived_debug";
      scenarioJson?: string;
      ownerUserId?: Id<"users"> | null;
      status?: "draft" | "published" | "archived" | "deleted" | "admin_deleted";
      updatedAt: number;
    } = { updatedAt: Date.now() };

    if (args.name !== undefined) {
      patch.name = normalizeMissionName(args.name);
    }
    if (args.description !== undefined) {
      patch.description = normalizeMissionDescription(args.description);
    }
    if (args.mapKey !== undefined) {
      patch.mapKey = args.mapKey.trim();
    }
    if (args.ownerUserId !== undefined) {
      patch.ownerUserId = await assertAssignableContentOwner(ctx, args.ownerUserId);
    }
    if (args.source !== undefined) {
      patch.source = args.source;
    }
    if (args.reviewStatus !== undefined) {
      patch.reviewStatus = args.reviewStatus;
    }
    if (args.mode !== undefined) {
      patch.mode = args.mode;
    }
    if (args.requiredTier !== undefined) {
      patch.requiredTier = args.requiredTier;
    }
    if (args.level !== undefined) {
      patch.level = normalizeMissionLevel(args.level);
    }
    if (args.requiredWins !== undefined) {
      patch.requiredWins = normalizeMissionRequiredWins(args.requiredWins);
    }
    if (args.prerequisiteMissionKeys !== undefined) {
      patch.prerequisiteMissionKeys = normalizeMissionPrerequisites(args.prerequisiteMissionKeys);
    }
    if (args.published !== undefined) {
      patch.published = args.published;
      patch.status = resolvePublisherContentStatus({
        status: undefined,
        published: args.published,
        defaultDraft: true,
      });
    }
    if (args.status !== undefined) {
      patch.status = args.status;
      patch.published = args.status === "published";
    }
    if (args.sortOrder !== undefined) {
      patch.sortOrder = normalizeMissionSortOrder(args.sortOrder);
    }
    if (args.retentionClass !== undefined) {
      patch.retentionClass = args.retentionClass;
    }
    if (args.scenarioJson !== undefined) {
      patch.scenarioJson = await normalizeMissionScenarioJson(ctx, args.scenarioJson);
    }
    if ((patch.source ?? existing.source ?? "official") === "official") {
      patch.ownerUserId = null;
      patch.reviewStatus = "approved";
    }

    if (existing.ownerUserId === undefined) {
      patch.ownerUserId = patch.ownerUserId ?? null;
    }
    if (existing.source === undefined) {
      patch.source = "official";
    }
    if (existing.reviewStatus === undefined) {
      patch.reviewStatus = patch.reviewStatus ?? resolvePublisherContentReviewStatus({
        source: patch.source ?? existing.source,
        reviewStatus: existing.reviewStatus,
      });
    }
    if (existing.status === undefined && args.published === undefined) {
      patch.status = resolvePublisherContentStatus({
        status: undefined,
        published: existing.published,
        defaultDraft: true,
      });
    }

    await ctx.db.patch("sim_missions", existing._id, patch);
    const nextSource = patch.source ?? existing.source ?? "official";
    const nextStatus =
      patch.status ??
      resolvePublisherContentStatus({
        status: existing.status,
        published: existing.published,
        defaultDraft: true,
      });
    const nextOwnerUserId =
      patch.ownerUserId !== undefined
        ? patch.ownerUserId
        : existing.ownerUserId === undefined
          ? null
          : existing.ownerUserId;
    await recordModerationEvent(ctx, {
      contentType: "mission",
      contentKey: key,
      actorUserId: userId,
      action: "updated",
      summary: `Updated mission metadata to ${nextSource} / ${nextStatus}${nextOwnerUserId === null ? " / system owner" : " / assigned owner"}.`,
      note: args.moderationNote,
    });
    return { key };
  },
});

export const bulkUpdateMissionStatus = mutation({
  args: {
    keys: v.array(v.string()),
    status: v.union(
      v.literal("draft"),
      v.literal("published"),
      v.literal("archived"),
      v.literal("deleted"),
      v.literal("admin_deleted"),
    ),
    moderationNote: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      throw new Error("Authentication required.");
    }

    const keys = normalizeUniqueKeys(args.keys, normalizeMissionKey);
    const updatedKeys: string[] = [];
    const skippedKeys: string[] = [];

    for (const key of keys) {
      const existing = await ctx.db
        .query("sim_missions")
        .withIndex("by_key", (q) => q.eq("key", key))
        .unique();
      if (existing === null) {
        skippedKeys.push(key);
        continue;
      }

      const currentStatus = resolvePublisherContentStatus({
        status: existing.status,
        published: existing.published,
        defaultDraft: true,
      });
      if (isTerminalContentStatus(currentStatus)) {
        skippedKeys.push(key);
        continue;
      }

      try {
        assertMayTransitionContentStatus({
          currentStatus,
          nextStatus: args.status,
          isAdmin: true,
        });
      } catch {
        skippedKeys.push(key);
        continue;
      }

      await ctx.db.patch("sim_missions", existing._id, {
        status: args.status,
        published: args.status === "published",
        updatedAt: Date.now(),
      });
      await recordModerationEvent(ctx, {
        contentType: "mission",
        contentKey: key,
        actorUserId: userId,
        action: "bulk_status_updated",
        summary: `Bulk updated status to ${args.status}.`,
        note: args.moderationNote,
      });
      updatedKeys.push(key);
    }

    return { updatedKeys, skippedKeys };
  },
});

export const bulkUpdateMissionOwner = mutation({
  args: {
    keys: v.array(v.string()),
    ownerUserId: v.union(v.id("users"), v.null()),
    moderationNote: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      throw new Error("Authentication required.");
    }

    const keys = normalizeUniqueKeys(args.keys, normalizeMissionKey);
    const ownerUserId = await assertAssignableContentOwner(ctx, args.ownerUserId);
    const updatedKeys: string[] = [];
    const skippedKeys: string[] = [];

    for (const key of keys) {
      const existing = await ctx.db
        .query("sim_missions")
        .withIndex("by_key", (q) => q.eq("key", key))
        .unique();
      if (existing === null) {
        skippedKeys.push(key);
        continue;
      }
      if ((existing.source ?? "official") === "official" && ownerUserId !== null) {
        skippedKeys.push(key);
        continue;
      }

      await ctx.db.patch("sim_missions", existing._id, {
        ownerUserId,
        updatedAt: Date.now(),
      });
      await recordModerationEvent(ctx, {
        contentType: "mission",
        contentKey: key,
        actorUserId: userId,
        action: "bulk_owner_updated",
        summary: ownerUserId === null ? "Bulk cleared owner to system." : "Bulk reassigned owner.",
        note: args.moderationNote,
      });
      updatedKeys.push(key);
    }

    return { updatedKeys, skippedKeys };
  },
});

export const bulkUpdateMissionSource = mutation({
  args: {
    keys: v.array(v.string()),
    source: v.union(v.literal("official"), v.literal("community")),
    moderationNote: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      throw new Error("Authentication required.");
    }

    const keys = normalizeUniqueKeys(args.keys, normalizeMissionKey);
    const updatedKeys: string[] = [];
    const skippedKeys: string[] = [];

    for (const key of keys) {
      const existing = await ctx.db
        .query("sim_missions")
        .withIndex("by_key", (q) => q.eq("key", key))
        .unique();
      if (existing === null) {
        skippedKeys.push(key);
        continue;
      }

      const currentStatus = resolvePublisherContentStatus({
        status: existing.status,
        published: existing.published,
        defaultDraft: true,
      });
      if (isTerminalContentStatus(currentStatus)) {
        skippedKeys.push(key);
        continue;
      }

      await ctx.db.patch("sim_missions", existing._id, {
        source: args.source,
        reviewStatus:
          args.source === "official"
            ? "approved"
            : resolvePublisherContentReviewStatus({
                source: args.source,
                reviewStatus: existing.reviewStatus,
              }),
        ownerUserId: args.source === "official" ? null : (existing.ownerUserId ?? null),
        updatedAt: Date.now(),
      });
      await recordModerationEvent(ctx, {
        contentType: "mission",
        contentKey: key,
        actorUserId: userId,
        action: "bulk_source_updated",
        summary:
          args.source === "official"
            ? "Bulk moved source to official and cleared owner."
            : "Bulk moved source to community.",
        note: args.moderationNote,
      });
      updatedKeys.push(key);
    }

    return { updatedKeys, skippedKeys };
  },
});

export const seedMissingMissions = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      throw new Error("Authentication required.");
    }

    let inserted = 0;
    let skipped = 0;

    for (const mission of BUILT_IN_MISSION_SEED_ROWS) {
      const existing = await ctx.db
        .query("sim_missions")
        .withIndex("by_key", (q) => q.eq("key", mission.key))
        .unique();
      if (existing !== null) {
        skipped += 1;
        continue;
      }

      const now = Date.now();
      await ctx.db.insert("sim_missions", {
        key: mission.key,
        name: mission.name,
        description: mission.description,
        mapKey: mission.mapKey,
        ownerUserId: mission.ownerUserId,
        source: mission.source,
        reviewStatus: "approved",
        status: mission.status,
        level: mission.level,
        requiredWins: mission.requiredWins,
        prerequisiteMissionKeys: mission.prerequisiteMissionKeys,
        published: mission.published,
        sortOrder: mission.sortOrder,
        retentionClass: mission.retentionClass,
        scenarioJson: mission.scenarioJson,
        createdAt: now,
        updatedAt: now,
      });
      inserted += 1;
    }

    return { inserted, skipped };
  },
});
