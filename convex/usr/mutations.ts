import { mutation } from "../_generated/server";
import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { api } from "../_generated/api";
import { Scrypt } from "lucia";
import { assignStarterOwnerEmpireSeat } from "../sim/mutations";
import { gameAllowsPlayerActions, touchGameMeaningfulActivity } from "../sim/helpers";
import { evaluateGameFinalization } from "../sim/finalization";
import { getMissionByKey, listMissions } from "./missionCatalog";
import {
  buildStrategyFromBaseAndOverrides,
  canonicalizeStrategyJson,
} from "./automationStrategyLibrary";
import { getAutomationStrategyByKey, getPublicAutomationStrategyByKey } from "./automationStrategyCatalog";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

const PASSWORD_PROVIDER_ID = "password";

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

async function listActiveGameRoles(
  ctx: MutationCtx,
  gameId: Id<"sim_games">,
) {
  const grouped = await Promise.all(
    (["admin", "empire", "trader", "observer"] as const).map((role) =>
      ctx.db
        .query("usr_game_roles")
        .withIndex("by_gameId_and_role", (q) => q.eq("gameId", gameId).eq("role", role))
        .collect(),
    ),
  );
  return grouped.flat().filter((role) => role.isActive);
}

async function releaseUserFromGameForNewAttempt(
  ctx: MutationCtx,
  params: { game: Doc<"sim_games">; userId: Id<"users"> },
): Promise<void> {
  const { game, userId } = params;
  const role = await ctx.db
    .query("usr_game_roles")
    .withIndex("by_gameId_and_userId", (q) =>
      q.eq("gameId", game._id).eq("userId", userId),
    )
    .unique();

  if (role === null || !role.isActive) {
    return;
  }

  await ctx.db.patch("usr_game_roles", role._id, {
    isActive: false,
  });

  if (role.role === "empire" && role.empireId !== null) {
    const empire = await ctx.db.get("emp_states", role.empireId);
    if (empire !== null && empire.gameId === game._id) {
      await ctx.db.patch("emp_states", empire._id, {
        controller: "npc",
        strategyJson: empire.strategyJson ?? "{}",
        playerName: empire.playerName ?? `${empire.name} AI`,
      });
    }
  }

  const humansRemaining = (await listActiveGameRoles(ctx, game._id)).length > 0;
  if (!humansRemaining) {
    await evaluateGameFinalization(ctx, {
      gameId: game._id,
      forceFinishReason: "abandoned_scored",
    });
    return;
  }

  await touchGameMeaningfulActivity(ctx, game._id, { humanAction: true });
}

function shouldRefreshMissionGame(
  game: Doc<"sim_games">,
  mission: Awaited<ReturnType<typeof listMissions>>[number],
): boolean {
  if (mission.updatedAt <= 0) {
    return false;
  }
  if (game.status !== "lobby" || game.startedAt !== null) {
    return false;
  }
  return (game.missionAppliedAt ?? 0) < mission.updatedAt;
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

export const setMyPassword = mutation({
  args: {
    password: v.string(),
  },
  handler: async (ctx, args): Promise<{ userId: Id<"users">; createdAccount: boolean }> => {
    const userId = await requireAuthUserId(ctx);
    const user = await ctx.db.get("users", userId);
    if (user === null) {
      throw new Error("User not found.");
    }

    const email = normalizeOptionalUserField(user.email)?.toLowerCase();
    if (email === undefined) {
      throw new Error("Password sign-in requires your account to have an email address.");
    }

    const password = normalizeOptionalPassword(args.password);
    if (password === undefined) {
      throw new Error("Password must be at least 8 characters.");
    }

    const existingPasswordAccount = await ctx.db
      .query("authAccounts")
      .withIndex("providerAndAccountId", (q) =>
        q.eq("provider", PASSWORD_PROVIDER_ID).eq("providerAccountId", email),
      )
      .unique();
    const secret = await new Scrypt().hash(password);

    if (existingPasswordAccount === null) {
      await ctx.db.insert("authAccounts", {
        userId,
        provider: PASSWORD_PROVIDER_ID,
        providerAccountId: email,
        secret,
        ...(user.emailVerificationTime !== undefined ? { emailVerified: email } : {}),
      });
      return { userId, createdAccount: true };
    }

    if (existingPasswordAccount.userId !== userId) {
      throw new Error("That email already belongs to another password sign-in account.");
    }

    await ctx.db.patch("authAccounts", existingPasswordAccount._id, {
      secret,
      ...(user.emailVerificationTime !== undefined ? { emailVerified: email } : {}),
    });
    return { userId, createdAccount: false };
  },
});

export const setMyDefaultStartingStrategy = mutation({
  args: {
    /** Pass a profile ID to set the default, or null to clear it (revert to Manual). */
    profileId: v.union(v.id("usr_automation_profiles"), v.null()),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuthUserId(ctx);

    if (args.profileId !== null) {
      const profile = await ctx.db.get("usr_automation_profiles", args.profileId);
      if (profile === null || profile.userId !== userId) {
        throw new Error("Automation profile not found.");
      }
    }

    const existing = await ctx.db
      .query("usr_profiles")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .unique();

    const patch = {
      defaultStartingStrategyProfileId:
        args.profileId !== null ? args.profileId : undefined,
    };

    if (existing === null) {
      await ctx.db.insert("usr_profiles", {
        userId,
        displayName: "",
        avatarUrl: null,
        timezone: null,
        analyticsConsent: false,
        ...patch,
      });
    } else {
      await ctx.db.patch("usr_profiles", existing._id, patch);
    }
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
    const libraryStrategy = await getPublicAutomationStrategyByKey(ctx, args.libraryKey);
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

    const libraryStrategy = await getAutomationStrategyByKey(ctx, profile.sourceLibraryKey);
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

export const clearMyEmpireAutomationStrategy = mutation({
  args: {
    gameId: v.id("sim_games"),
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

    await ctx.db.patch("emp_states", empireId, {
      strategyJson: undefined,
    });
    await touchGameMeaningfulActivity(ctx, args.gameId, { humanAction: true });
    return empireId;
  },
});

export const queueMyEmpireStandingOrdersRefresh = mutation({
  args: {
    gameId: v.id("sim_games"),
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

    if (turnRow?.state === undefined || turnRow.state === "open") {
      const existingRoutes = await ctx.db
        .query("flt_garrison_routes")
        .withIndex("by_gameId_and_empireId", (q) =>
          q.eq("gameId", args.gameId).eq("empireId", empireId),
        )
        .take(256);

      for (const route of existingRoutes) {
        await ctx.db.delete("flt_garrison_routes", route._id);
      }
    }

    const requestedAt = Date.now();
    await ctx.db.patch("emp_states", empireId, {
      standingOrdersRefreshRequestedAt: requestedAt,
    });
    await touchGameMeaningfulActivity(ctx, args.gameId, { humanAction: true });
    return {
      empireId,
      queuedAt: requestedAt,
      turnResolving: turnRow?.state !== undefined && turnRow.state !== "open",
    };
  },
});

export const resignFromGame = mutation({
  args: {
    gameId: v.id("sim_games"),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuthUserId(ctx);
    const role = await ctx.db
      .query("usr_game_roles")
      .withIndex("by_gameId_and_userId", (q) =>
        q.eq("gameId", args.gameId).eq("userId", userId),
      )
      .unique();

    if (role === null || !role.isActive) {
      throw new Error("You are not an active member of this game.");
    }

    const game = await ctx.db.get("sim_games", args.gameId);
    if (game === null) {
      throw new Error("Game not found.");
    }
    if (game.finalizationState === "pending_cleanup" || game.finalizationState === "cleaned") {
      throw new Error("This game is already being cleaned up.");
    }

    await ctx.db.patch("usr_game_roles", role._id, {
      isActive: false,
    });

    if (role.role === "empire" && role.empireId !== null) {
      const empire = await ctx.db.get("emp_states", role.empireId);
      if (empire !== null && empire.gameId === args.gameId) {
        await ctx.db.patch("emp_states", empire._id, {
          controller: "npc",
          strategyJson: empire.strategyJson ?? "{}",
          playerName: empire.playerName ?? `${empire.name} AI`,
        });
      }
    }

    const activeRoles = await listActiveGameRoles(ctx, args.gameId);
    const humansRemaining = activeRoles.length > 0;

    if (!humansRemaining) {
      const result = await evaluateGameFinalization(ctx, {
        gameId: args.gameId,
        forceFinishReason: "abandoned_scored",
      });
      return {
        resigned: true,
        finalized: result.finalized,
        finishReason: result.finishReason,
      };
    }

    await touchGameMeaningfulActivity(ctx, args.gameId, { humanAction: true });
    return {
      resigned: true,
      finalized: false,
      finishReason: null,
    };
  },
});

export const ensureMyStarterGames = mutation({
  args: {},
  handler: async (ctx): Promise<{ created: number }> => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      throw new Error("Authentication required.");
    }

    const [missions, ownedGames] = await Promise.all([
      listMissions(ctx, { publishedOnly: true, fallbackToBuiltIns: true }),
      ctx.db.query("sim_games").withIndex("by_ownerUserId", (q) => q.eq("ownerUserId", userId)).collect(),
    ]);

    let created = 0;
    for (const scenario of missions) {
      const existingGame =
        ownedGames.find((game) => (game.missionKey ?? game.lobbyScenarioKey) === scenario.key) ?? null;
      if (existingGame !== null) {
        if (shouldRefreshMissionGame(existingGame, scenario)) {
          await ctx.db.patch("sim_games", existingGame._id, {
            ownerUserId: null,
          });
        } else {
        if (
          existingGame.status === "finished" ||
          existingGame.finalizationState === "pending_cleanup" ||
          existingGame.finalizationState === "cleaned"
        ) {
          continue;
        }
        const existingRole = await ctx.db
          .query("usr_game_roles")
          .withIndex("by_gameId_and_userId", (q) =>
            q.eq("gameId", existingGame._id).eq("userId", userId),
          )
          .unique();
        if (existingRole === null) {
          await assignStarterOwnerEmpireSeat(ctx, { gameId: existingGame._id, userId });
        }
        continue;
        }
      }

      await ctx.runMutation(api.sim.mutations.createGame, {
        name: scenario.name,
        mapKey: scenario.mapKey,
        seed: `${scenario.key}:${userId}:${Date.now()}`,
        npcEmpireKeys: scenario.scenario.npcEmpireKeys,
        automatedEmpireKeys: scenario.scenario.automatedEmpireKeys,
        missionKey: scenario.key,
        lobbyScenarioKey: scenario.key,
        retentionClass: scenario.retentionClass,
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

    const scenario = await getMissionByKey(ctx, args.scenarioKey);
    if (scenario === null) {
      throw new Error("Unknown mission.");
    }

    const current = await ctx.db
      .query("sim_games")
      .withIndex("by_ownerUserId", (q) => q.eq("ownerUserId", userId))
      .collect()
      .then((games) =>
        games.find((game) => (game.missionKey ?? game.lobbyScenarioKey) === scenario.key) ?? null,
      );

    if (
      current !== null &&
      (current.status === "lobby" || current.status === "running" || current.status === "paused")
    ) {
      await releaseUserFromGameForNewAttempt(ctx, { game: current, userId });
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
      npcEmpireKeys: scenario.scenario.npcEmpireKeys,
      automatedEmpireKeys: scenario.scenario.automatedEmpireKeys,
      missionKey: scenario.key,
      lobbyScenarioKey: scenario.key,
      retentionClass: scenario.retentionClass,
    });

    return { gameId };
  },
});
