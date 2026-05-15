import { mutation, query } from "../_generated/server";
import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { Scrypt } from "lucia";
import { assertGameAdmin } from "../sim/helpers";
import {
  DEFAULT_GAME_SETTINGS,
  loadGameSettings,
} from "../sim/economy/gameSettings";
import { evaluateGameFinalization, queueFinishedGameCleanup } from "../sim/finalization";

function normalizeAdminCreatedEmail(email: string): string {
  const normalized = email.trim().toLowerCase();
  if (!normalized || !normalized.includes("@")) {
    throw new Error("A valid email address is required.");
  }
  return normalized;
}

function normalizeOptionalUserText(value: string | null | undefined): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

type CreatedAuthUserResult = {
  userId: Id<"users">;
  image: string | null;
};

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
      retentionClass: "discarded",
      finishReason: "admin_terminated_discarded",
      finalizationState: "pending_cleanup",
    });

    await queueFinishedGameCleanup(ctx, args.gameId);

    return { deleting: true as const };
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

    if ((await ctx.db.get("sim_games", args.gameId)) === null) {
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
      throw new Error("Retention class can no longer be changed for a game already in cleanup.");
    }

    await ctx.db.patch("sim_games", args.gameId, {
      retentionClass: args.retentionClass,
    });

    return { retentionClass: args.retentionClass } as const;
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

export const createUser = mutation({
  args: {
    gameId: v.id("sim_games"),
    email: v.string(),
    password: v.string(),
    name: v.optional(v.union(v.string(), v.null())),
    displayName: v.optional(v.union(v.string(), v.null())),
  },
  handler: async (ctx, args): Promise<{ userId: Id<"users"> }> => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      throw new Error("Authentication required.");
    }
    await assertGameAdmin(ctx, args.gameId, userId);

    const email = normalizeAdminCreatedEmail(args.email);
    if (args.password.length < 8) {
      throw new Error("Password must be at least 8 characters.");
    }

    const name = normalizeOptionalUserText(args.name);
    const displayName = normalizeOptionalUserText(args.displayName);

    const existingAccount = await ctx.db
      .query("authAccounts")
      .withIndex("providerAndAccountId", (q) =>
        q.eq("provider", "password").eq("providerAccountId", email),
      )
      .unique();
    if (existingAccount !== null) {
      throw new Error(`Account ${email} already exists.`);
    }

    const createdUserId = await ctx.db.insert("users", {
      email,
      ...(name !== undefined ? { name } : {}),
    });
    const passwordHash = await new Scrypt().hash(args.password);
    await ctx.db.insert("authAccounts", {
      userId: createdUserId,
      provider: "password",
      providerAccountId: email,
      secret: passwordHash,
    });

    const created: CreatedAuthUserResult = {
      userId: createdUserId,
      image: null,
    };

    if (displayName !== undefined) {
      const existingProfile = await ctx.db
        .query("usr_profiles")
        .withIndex("by_userId", (q) => q.eq("userId", created.userId))
        .unique();

      const profileFields = {
        displayName,
        avatarUrl: created.image,
        timezone: null,
        analyticsConsent: false,
      };

      if (existingProfile === null) {
        await ctx.db.insert("usr_profiles", {
          userId: created.userId,
          ...profileFields,
        });
      } else {
        await ctx.db.patch("usr_profiles", existingProfile._id, profileFields);
      }
    }

    return {
      userId: created.userId,
    };
  },
});
