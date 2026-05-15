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

async function findPasswordAccountByEmail(ctx: MutationCtx, email: string) {
  return await ctx.db
    .query("authAccounts")
    .withIndex("providerAndAccountId", (q) =>
      q.eq("provider", PASSWORD_PROVIDER_ID).eq("providerAccountId", email),
    )
    .unique();
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
    return await loadGameSettings(ctx, args.gameId);
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

    function clamp(v: number, lo: number, hi: number) {
      return Math.min(hi, Math.max(lo, v));
    }

    const s = args.settings;
    const safe = {
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
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      throw new Error("Authentication required.");
    }
    await assertGameAdmin(ctx, args.gameId, userId);

    await ctx.runMutation(internal.sim.internal.prepareTurnResolutionRetry, {
      gameId: args.gameId,
    });

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

export const createUser = mutation({
  args: {
    name: v.optional(v.union(v.string(), v.null())),
    email: v.optional(v.union(v.string(), v.null())),
    phone: v.optional(v.union(v.string(), v.null())),
    image: v.optional(v.union(v.string(), v.null())),
    password: v.optional(v.union(v.string(), v.null())),
    isAnonymous: v.boolean(),
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
      ...(args.emailVerified ? { emailVerificationTime: now } : {}),
      ...(args.phoneVerified ? { phoneVerificationTime: now } : {}),
      ...(args.isAnonymous ? { isAnonymous: true } : {}),
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
