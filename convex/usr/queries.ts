import { query } from "../_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { STARTER_LOBBY_SCENARIOS, mapTierFromMapKey } from "./lobbyScenarios";
import {
  getPublicAutomationStrategy,
  PUBLIC_AUTOMATION_STRATEGIES,
  summarizeAutomationStrategy,
} from "./automationStrategyLibrary";

export const getMyProfile = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      return null;
    }

    return await ctx.db
      .query("usr_profiles")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .unique();
  },
});

export const listMyRoles = query({
  args: { gameId: v.id("sim_games") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      return [];
    }

    const role = await ctx.db
      .query("usr_game_roles")
      .withIndex("by_gameId_and_userId", (q) =>
        q.eq("gameId", args.gameId).eq("userId", userId),
      )
      .unique();

    if (role === null || !role.isActive) {
      return [];
    }
    return [role];
  },
});

export const listGamePlayersForAdmin = query({
  args: { gameId: v.id("sim_games"), limit: v.number() },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      return [];
    }

    const binding = await ctx.db
      .query("usr_game_roles")
      .withIndex("by_gameId_and_userId", (q) =>
        q.eq("gameId", args.gameId).eq("userId", userId),
      )
      .unique();
    if (binding === null || !binding.isActive || binding.role !== "admin") {
      return [];
    }

    const roles = [];
    for (const role of ["admin", "empire", "trader", "observer"] as const) {
      const rows = await ctx.db
        .query("usr_game_roles")
        .withIndex("by_gameId_and_role", (q) =>
          q.eq("gameId", args.gameId).eq("role", role),
        )
        .take(args.limit);
      roles.push(...rows);
    }

    const activeRoles = roles.filter((role) => role.isActive).slice(0, args.limit);
    const result = [];
    for (const role of activeRoles) {
      const profile = await ctx.db
        .query("usr_profiles")
        .withIndex("by_userId", (q) => q.eq("userId", role.userId))
        .unique();
      result.push({
        roleId: role._id,
        userId: role.userId,
        role: role.role,
        empireId: role.empireId,
        displayName: profile?.displayName ?? `Player ${role.userId.slice(-4)}`,
      });
    }
    return result;
  },
});

export const getMyLobbyState = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      return null;
    }

    const currentGames = await ctx.db
      .query("sim_games")
      .withIndex("by_ownerUserId", (q) => q.eq("ownerUserId", userId))
      .collect();

    const historicalGames = await ctx.db
      .query("sim_games")
      .withIndex("by_createdByUserId", (q) => q.eq("createdByUserId", userId))
      .collect();

    const wins = historicalGames.filter(
      (game) =>
        game.lobbyScenarioKey !== null &&
        game.status === "finished" &&
        game.winnerEmpireKey === "aurora",
    );
    const smallWins = wins.filter((game) => mapTierFromMapKey(game.mapKey) === "small").length;
    const mediumWins = wins.filter((game) => mapTierFromMapKey(game.mapKey) === "medium").length;

    const gamesByScenario = new Map(
      currentGames
        .filter((game) => game.lobbyScenarioKey !== null)
        .map((game) => [game.lobbyScenarioKey, game]),
    );

    return {
      progression: {
        smallWins,
        mediumWins,
        mediumUnlocked: smallWins >= 2,
        largeUnlocked: mediumWins >= 1,
      },
      games: STARTER_LOBBY_SCENARIOS.map((scenario) => {
        const game = gamesByScenario.get(scenario.key) ?? null;
        const unlocked =
          smallWins >= scenario.requiredSmallWins &&
          mediumWins >= scenario.requiredMediumWins;
        return {
          key: scenario.key,
          name: scenario.name,
          mapKey: scenario.mapKey,
          mapTier: scenario.mapTier,
          sortOrder: scenario.sortOrder,
          npcCount: scenario.automatedEmpireKeys.length,
          requiredSmallWins: scenario.requiredSmallWins,
          requiredMediumWins: scenario.requiredMediumWins,
          unlocked,
          game,
        };
      }),
    };
  },
});

export const listPublicAutomationStrategies = query({
  args: {},
  handler: async () => {
    return PUBLIC_AUTOMATION_STRATEGIES;
  },
});

export const listMyAutomationProfiles = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      return [];
    }

    const rows = await ctx.db
      .query("usr_automation_profiles")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .take(128);

    return rows
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map((row) => ({
        ...row,
        sourceLibrary:
          row.sourceLibraryKey !== undefined
            ? getPublicAutomationStrategy(row.sourceLibraryKey)
            : null,
        automationPreview: summarizeAutomationStrategy(row.strategyJson),
      }));
  },
});

export const getMyAutomationProfile = query({
  args: { profileId: v.id("usr_automation_profiles") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      return null;
    }

    const profile = await ctx.db.get("usr_automation_profiles", args.profileId);
    if (profile === null || profile.userId !== userId) {
      return null;
    }

    return {
      ...profile,
      sourceLibrary:
        profile.sourceLibraryKey !== undefined
          ? getPublicAutomationStrategy(profile.sourceLibraryKey)
          : null,
      automationPreview: summarizeAutomationStrategy(profile.strategyJson),
    };
  },
});

export const getMyEmpireAutomationStrategy = query({
  args: { gameId: v.id("sim_games") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      return null;
    }

    const role = await ctx.db
      .query("usr_game_roles")
      .withIndex("by_gameId_and_userId", (q) =>
        q.eq("gameId", args.gameId).eq("userId", userId),
      )
      .unique();

    if (
      role === null ||
      !role.isActive ||
      role.role !== "empire" ||
      role.empireId === null
    ) {
      return null;
    }

    const empire = await ctx.db.get("emp_states", role.empireId);
    if (empire === null || empire.gameId !== args.gameId) {
      return null;
    }

    return {
      empireId: empire._id,
      empireKey: empire.empireKey,
      empireName: empire.name,
      strategyJson: empire.strategyJson ?? null,
      automationPreview:
        empire.strategyJson !== undefined
          ? summarizeAutomationStrategy(empire.strategyJson)
          : null,
      strategicSliderOverrides: empire.strategicSliderOverrides ?? null,
    };
  },
});
