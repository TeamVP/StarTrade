import { mutation } from "../_generated/server";
import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { api } from "../_generated/api";
import { assignStarterOwnerEmpireSeat } from "../sim/mutations";
import { getStarterLobbyScenario, STARTER_LOBBY_SCENARIOS } from "./lobbyScenarios";
import {
  buildStrategyFromBaseAndOverrides,
  canonicalizeStrategyJson,
  getPublicAutomationStrategy,
} from "./automationStrategyLibrary";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

async function requireAuthUserId(ctx: MutationCtx): Promise<Id<"users">> {
  const userId = await getAuthUserId(ctx);
  if (userId === null) {
    throw new Error("Authentication required.");
  }
  return userId;
}

function normalizeProfileName(name: string): string {
  const normalized = name.trim();
  if (normalized.length === 0) {
    throw new Error("Profile name is required.");
  }
  return normalized;
}

function normalizeOptionalDescription(description: string | null | undefined): string | undefined {
  if (description === undefined || description === null) {
    return undefined;
  }
  const normalized = description.trim();
  return normalized.length > 0 ? normalized : undefined;
}

async function getOwnedAutomationProfileOrThrow(
  ctx: MutationCtx,
  userId: Id<"users">,
  profileId: Id<"usr_automation_profiles">,
) {
  const profile = await ctx.db.get("usr_automation_profiles", profileId);
  if (profile === null || profile.userId !== userId) {
    throw new Error("Automation profile not found.");
  }
  return profile;
}

async function assertEmpireSeatForGame(
  ctx: MutationCtx,
  params: { gameId: Id<"sim_games">; userId: Id<"users"> },
): Promise<Id<"emp_states">> {
  const binding = await ctx.db
    .query("usr_game_roles")
    .withIndex("by_gameId_and_userId", (q) =>
      q.eq("gameId", params.gameId).eq("userId", params.userId),
    )
    .unique();
  if (
    binding === null ||
    !binding.isActive ||
    binding.role !== "empire" ||
    binding.empireId === null
  ) {
    throw new Error("You need an active empire seat in this game.");
  }
  return binding.empireId;
}

export const upsertMyProfile = mutation({
  args: {
    displayName: v.string(),
    avatarUrl: v.union(v.string(), v.null()),
    timezone: v.union(v.string(), v.null()),
    analyticsConsent: v.boolean(),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      throw new Error("Authentication required.");
    }

    const existing = await ctx.db
      .query("usr_profiles")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .unique();

    if (existing === null) {
      return await ctx.db.insert("usr_profiles", { userId, ...args });
    }

    await ctx.db.patch("usr_profiles", existing._id, args);
    return existing._id;
  },
});

export const createCustomAutomationProfile = mutation({
  args: {
    name: v.string(),
    description: v.optional(v.union(v.string(), v.null())),
    strategyJson: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuthUserId(ctx);
    const now = Date.now();
    return await ctx.db.insert("usr_automation_profiles", {
      userId,
      name: normalizeProfileName(args.name),
      description: normalizeOptionalDescription(args.description),
      isActive: true,
      sourceKind: "custom",
      strategyJson: canonicalizeStrategyJson(args.strategyJson),
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const createAutomationProfileFromLibrary = mutation({
  args: {
    libraryKey: v.string(),
    name: v.string(),
    description: v.optional(v.union(v.string(), v.null())),
    overridesJson: v.optional(v.union(v.string(), v.null())),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuthUserId(ctx);
    const libraryStrategy = getPublicAutomationStrategy(args.libraryKey);
    if (libraryStrategy === null) {
      throw new Error("Public automation strategy not found.");
    }

    const built = buildStrategyFromBaseAndOverrides({
      baseStrategyJson: libraryStrategy.strategyJson,
      overridesJson: args.overridesJson ?? null,
    });
    const now = Date.now();
    return await ctx.db.insert("usr_automation_profiles", {
      userId,
      name: normalizeProfileName(args.name),
      description: normalizeOptionalDescription(args.description),
      isActive: true,
      sourceKind: "library",
      sourceLibraryKey: libraryStrategy.key,
      overridesJson: built.normalizedOverridesJson ?? undefined,
      strategyJson: built.strategyJson,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const updateCustomAutomationProfile = mutation({
  args: {
    profileId: v.id("usr_automation_profiles"),
    name: v.optional(v.string()),
    description: v.optional(v.union(v.string(), v.null())),
    isActive: v.optional(v.boolean()),
    strategyJson: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuthUserId(ctx);
    const profile = await getOwnedAutomationProfileOrThrow(ctx, userId, args.profileId);
    if (profile.sourceKind !== "custom") {
      throw new Error("This automation profile is library-derived. Update its overrides instead.");
    }

    const patch: {
      name?: string;
      description?: string | undefined;
      isActive?: boolean;
      strategyJson?: string;
      updatedAt: number;
    } = { updatedAt: Date.now() };

    if (args.name !== undefined) {
      patch.name = normalizeProfileName(args.name);
    }
    if (args.description !== undefined) {
      patch.description = normalizeOptionalDescription(args.description);
    }
    if (args.isActive !== undefined) {
      patch.isActive = args.isActive;
    }
    if (args.strategyJson !== undefined) {
      patch.strategyJson = canonicalizeStrategyJson(args.strategyJson);
    }

    await ctx.db.patch("usr_automation_profiles", profile._id, patch);
    return profile._id;
  },
});

export const updateLibraryAutomationProfile = mutation({
  args: {
    profileId: v.id("usr_automation_profiles"),
    name: v.optional(v.string()),
    description: v.optional(v.union(v.string(), v.null())),
    isActive: v.optional(v.boolean()),
    overridesJson: v.optional(v.union(v.string(), v.null())),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuthUserId(ctx);
    const profile = await getOwnedAutomationProfileOrThrow(ctx, userId, args.profileId);
    if (profile.sourceKind !== "library" || profile.sourceLibraryKey === undefined) {
      throw new Error("This automation profile is custom. Update its strategy JSON instead.");
    }

    const libraryStrategy = getPublicAutomationStrategy(profile.sourceLibraryKey);
    if (libraryStrategy === null) {
      throw new Error("The source public automation strategy no longer exists.");
    }

    const built = buildStrategyFromBaseAndOverrides({
      baseStrategyJson: libraryStrategy.strategyJson,
      overridesJson:
        args.overridesJson !== undefined
          ? args.overridesJson
          : profile.overridesJson ?? null,
    });

    const patch: {
      name?: string;
      description?: string | undefined;
      isActive?: boolean;
      overridesJson?: string | undefined;
      strategyJson: string;
      updatedAt: number;
    } = {
      overridesJson: built.normalizedOverridesJson ?? undefined,
      strategyJson: built.strategyJson,
      updatedAt: Date.now(),
    };

    if (args.name !== undefined) {
      patch.name = normalizeProfileName(args.name);
    }
    if (args.description !== undefined) {
      patch.description = normalizeOptionalDescription(args.description);
    }
    if (args.isActive !== undefined) {
      patch.isActive = args.isActive;
    }

    await ctx.db.patch("usr_automation_profiles", profile._id, patch);
    return profile._id;
  },
});

export const setAutomationProfileActive = mutation({
  args: {
    profileId: v.id("usr_automation_profiles"),
    isActive: v.boolean(),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuthUserId(ctx);
    const profile = await getOwnedAutomationProfileOrThrow(ctx, userId, args.profileId);
    await ctx.db.patch("usr_automation_profiles", profile._id, {
      isActive: args.isActive,
      updatedAt: Date.now(),
    });
    return profile._id;
  },
});

export const duplicateMyAutomationProfile = mutation({
  args: {
    profileId: v.id("usr_automation_profiles"),
    name: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuthUserId(ctx);
    const profile = await getOwnedAutomationProfileOrThrow(ctx, userId, args.profileId);
    const now = Date.now();
    return await ctx.db.insert("usr_automation_profiles", {
      userId,
      name:
        args.name !== undefined
          ? normalizeProfileName(args.name)
          : `${profile.name} Copy`,
      description: profile.description,
      isActive: profile.isActive ?? true,
      sourceKind: profile.sourceKind,
      sourceLibraryKey: profile.sourceLibraryKey,
      overridesJson: profile.overridesJson,
      strategyJson: profile.strategyJson,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const deleteMyAutomationProfile = mutation({
  args: { profileId: v.id("usr_automation_profiles") },
  handler: async (ctx, args) => {
    const userId = await requireAuthUserId(ctx);
    const profile = await getOwnedAutomationProfileOrThrow(ctx, userId, args.profileId);
    await ctx.db.delete(profile._id);
    return profile._id;
  },
});

export const saveMyEmpireAutomationProfile = mutation({
  args: {
    gameId: v.id("sim_games"),
    name: v.string(),
    description: v.optional(v.union(v.string(), v.null())),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuthUserId(ctx);
    const empireId = await assertEmpireSeatForGame(ctx, {
      gameId: args.gameId,
      userId,
    });
    const empire = await ctx.db.get("emp_states", empireId);
    if (empire === null || empire.gameId !== args.gameId) {
      throw new Error("Empire not found.");
    }
    if (empire.strategyJson === undefined) {
      throw new Error("This empire does not currently have an automation strategy to save.");
    }

    const now = Date.now();
    return await ctx.db.insert("usr_automation_profiles", {
      userId,
      name: normalizeProfileName(args.name),
      description: normalizeOptionalDescription(args.description),
      isActive: true,
      sourceKind: "custom",
      strategyJson: canonicalizeStrategyJson(empire.strategyJson),
      createdAt: now,
      updatedAt: now,
      lastUsedAt: now,
    });
  },
});

export const applyAutomationProfileToMyEmpire = mutation({
  args: {
    gameId: v.id("sim_games"),
    profileId: v.id("usr_automation_profiles"),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuthUserId(ctx);
    const profile = await getOwnedAutomationProfileOrThrow(ctx, userId, args.profileId);
    const empireId = await assertEmpireSeatForGame(ctx, {
      gameId: args.gameId,
      userId,
    });
    const empire = await ctx.db.get("emp_states", empireId);
    if (empire === null || empire.gameId !== args.gameId) {
      throw new Error("Empire not found.");
    }

    const now = Date.now();
    await ctx.db.patch("emp_states", empireId, {
      strategyJson: profile.strategyJson,
    });
    await ctx.db.patch("usr_automation_profiles", profile._id, {
      lastUsedAt: now,
      updatedAt: now,
    });
    return empireId;
  },
});

export const ensureMyStarterGames = mutation({
  args: {},
  handler: async (ctx): Promise<{ created: number }> => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      throw new Error("Authentication required.");
    }

    let created = 0;
    for (const scenario of STARTER_LOBBY_SCENARIOS) {
      const existing = await ctx.db
        .query("sim_games")
        .withIndex("by_ownerUserId_and_lobbyScenarioKey", (q) =>
          q.eq("ownerUserId", userId).eq("lobbyScenarioKey", scenario.key),
        )
        .take(1);
      if (existing.length > 0) {
        await assignStarterOwnerEmpireSeat(ctx, { gameId: existing[0]!._id, userId });
        continue;
      }

      await ctx.runMutation(api.sim.mutations.createGame, {
        name: scenario.name,
        mapKey: scenario.mapKey,
        seed: `${scenario.key}:${userId}:${Date.now()}`,
        npcEmpireKeys: scenario.npcEmpireKeys,
        automatedEmpireKeys: scenario.automatedEmpireKeys,
        lobbyScenarioKey: scenario.key,
      });
      created += 1;
    }

    return { created };
  },
});

export const resetMyStarterGame = mutation({
  args: { scenarioKey: v.string() },
  handler: async (ctx, args): Promise<{ gameId: string }> => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      throw new Error("Authentication required.");
    }

    const scenario = getStarterLobbyScenario(args.scenarioKey);
    if (scenario === null) {
      throw new Error("Unknown starter scenario.");
    }

    const existing = await ctx.db
      .query("sim_games")
      .withIndex("by_ownerUserId_and_lobbyScenarioKey", (q) =>
        q.eq("ownerUserId", userId).eq("lobbyScenarioKey", scenario.key),
      )
      .take(1);
    const current = existing[0] ?? null;

    if (current !== null && current.status === "running") {
      throw new Error("Pause or finish the current run before starting a new attempt.");
    }

    if (current !== null) {
      await ctx.db.patch("sim_games", current._id, {
        ownerUserId: null,
      });
    }

    const gameId = await ctx.runMutation(api.sim.mutations.createGame, {
      name: scenario.name,
      mapKey: scenario.mapKey,
      seed: `${scenario.key}:${userId}:${Date.now()}`,
      npcEmpireKeys: scenario.npcEmpireKeys,
      automatedEmpireKeys: scenario.automatedEmpireKeys,
      lobbyScenarioKey: scenario.key,
    });

    return { gameId };
  },
});
