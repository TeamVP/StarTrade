import { query, type QueryCtx } from "../_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import { STARTER_LOBBY_SCENARIOS, mapTierFromMapKey } from "./lobbyScenarios";
import {
  getPublicAutomationStrategy,
  PUBLIC_AUTOMATION_STRATEGIES,
  summarizeAutomationStrategy,
} from "./automationStrategyLibrary";

type EmpireResultWithGame = Doc<"emp_results"> & {
  gameResult: Doc<"sim_game_results">;
};

async function attachGameResults(
  ctx: QueryCtx,
  rows: Doc<"emp_results">[],
): Promise<EmpireResultWithGame[]> {
  const gameResultMap = new Map<Id<"sim_game_results">, Doc<"sim_game_results">>();
  for (const row of rows) {
    if (gameResultMap.has(row.gameResultId)) continue;
    const gameResult = await ctx.db.get("sim_game_results", row.gameResultId);
    if (gameResult !== null) {
      gameResultMap.set(row.gameResultId, gameResult);
    }
  }
  return rows.flatMap((row) => {
    const gameResult = gameResultMap.get(row.gameResultId);
    return gameResult === undefined ? [] : [{ ...row, gameResult }];
  });
}

function rankGroupedResults<T extends { wins: number; top3: number; games: number; score: number; key: string }>(
  rows: T[],
): T[] {
  return rows.sort((a, b) => {
    if (a.wins !== b.wins) return b.wins - a.wins;
    if (a.top3 !== b.top3) return b.top3 - a.top3;
    if (a.score !== b.score) return b.score - a.score;
    if (a.games !== b.games) return b.games - a.games;
    return a.key.localeCompare(b.key);
  });
}

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

export const getMyAccount = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      return null;
    }

    const user = await ctx.db.get("users", userId);
    if (user === null) {
      return null;
    }

    const profile = await ctx.db
      .query("usr_profiles")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .unique();

    return {
      user: {
        _id: user._id,
        email: user.email ?? null,
        name: user.name ?? null,
        image: user.image ?? null,
        isAnonymous: user.isAnonymous ?? false,
      },
      profile,
    };
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

    const winningRows = await ctx.db
      .query("emp_results")
      .withIndex("by_userId_and_isWinner", (q) => q.eq("userId", userId).eq("isWinner", true))
      .take(256);
    const wins = await attachGameResults(ctx, winningRows);
    const auroraWins = wins.filter(
      (row) =>
        row.empireKey === "aurora" &&
        row.gameResult.isOfficial &&
        row.gameResult.lobbyScenarioKey !== null,
    );
    const smallWins = auroraWins.filter(
      (row) => mapTierFromMapKey(row.gameResult.mapKey) === "small",
    ).length;
    const mediumWins = auroraWins.filter(
      (row) => mapTierFromMapKey(row.gameResult.mapKey) === "medium",
    ).length;

    const gamesByScenario = new Map(
      currentGames
        .filter((game) => game.lobbyScenarioKey !== null)
        .map((game) => [game.lobbyScenarioKey, game]),
    );

    const resultByGameId = new Map<
      Id<"sim_games">,
      {
        endedAt: number;
        finishReason: Doc<"sim_game_results">["finishReason"];
        winnerEmpireKey: string | null;
        winnerEmpireName: string | null;
        winnerPlayerName: string | null;
        auroraPlacement: number | null;
        auroraScoreFinal: number | null;
        auroraStarsControlledFinal: number | null;
        auroraFleetStrengthFinal: number | null;
        auroraWasWinner: boolean;
      }
    >();

    for (const game of currentGames) {
      if (game.status !== "finished") continue;
      const gameResult = await ctx.db
        .query("sim_game_results")
        .withIndex("by_gameId", (q) => q.eq("gameId", game._id))
        .unique();
      if (gameResult === null) continue;

      const empireResults = await ctx.db
        .query("emp_results")
        .withIndex("by_gameResultId", (q) => q.eq("gameResultId", gameResult._id))
        .collect();
      const winner = empireResults.find((row) => row.isWinner) ?? null;
      const aurora = empireResults.find((row) => row.empireKey === "aurora") ?? null;

      resultByGameId.set(game._id, {
        endedAt: gameResult.endedAt,
        finishReason: gameResult.finishReason,
        winnerEmpireKey: winner?.empireKey ?? null,
        winnerEmpireName: winner?.empireName ?? null,
        winnerPlayerName: winner?.playerName ?? null,
        auroraPlacement: aurora?.placement ?? null,
        auroraScoreFinal: aurora?.scoreFinal ?? null,
        auroraStarsControlledFinal: aurora?.starsControlledFinal ?? null,
        auroraFleetStrengthFinal: aurora?.fleetStrengthFinal ?? null,
        auroraWasWinner: aurora?.isWinner ?? false,
      });
    }

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
          result: game === null ? null : resultByGameId.get(game._id) ?? null,
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

export const listRecentOfficialEmpireResults = query({
  args: { limit: v.number() },
  handler: async (ctx, args) => {
    const limit = Math.min(Math.max(Math.floor(args.limit), 1), 50);
    const gameResults = await ctx.db
      .query("sim_game_results")
      .withIndex("by_isOfficial_and_endedAt", (q) => q.eq("isOfficial", true))
      .order("desc")
      .take(limit);

    const results = [] as Array<{
      gameId: Id<"sim_games">;
      endedAt: number;
      name: string;
      mapKey: string;
      finishReason: Doc<"sim_game_results">["finishReason"];
      winner: {
        empireKey: string;
        empireName: string;
        controllerKind: "human" | "npc";
        playerName: string | null;
        userId: Id<"users"> | null;
        npcPlayerKey: string | null;
        scoreFinal: number;
        starsControlledFinal: number;
        fleetStrengthFinal: number;
        strategySummaryJson: string | null;
      } | null;
    }>;

    for (const gameResult of gameResults) {
      const winner = gameResult.winnerEmpireResultId === null
        ? null
        : await ctx.db.get("emp_results", gameResult.winnerEmpireResultId);
      results.push({
        gameId: gameResult.gameId,
        endedAt: gameResult.endedAt,
        name: gameResult.name,
        mapKey: gameResult.mapKey,
        finishReason: gameResult.finishReason,
        winner:
          winner === null
            ? null
            : {
                empireKey: winner.empireKey,
                empireName: winner.empireName,
                controllerKind: winner.controllerKind,
                playerName: winner.playerName,
                userId: winner.userId,
                npcPlayerKey: winner.npcPlayerKey,
                scoreFinal: winner.scoreFinal,
                starsControlledFinal: winner.starsControlledFinal,
                fleetStrengthFinal: winner.fleetStrengthFinal,
                strategySummaryJson: winner.strategySummaryJson,
              },
      });
    }

    return results;
  },
});

export const listEmpireUserLeaderboard = query({
  args: { limit: v.number() },
  handler: async (ctx, args) => {
    const allRows = await ctx.db.query("emp_results").take(512);
    const officialRows = (await attachGameResults(ctx, allRows))
      .filter((row) => row.gameResult.isOfficial)
      .map((row) => row as Doc<"emp_results">);
    const withUsers = officialRows.filter((row) => row.userId !== null);
    const grouped = new Map<
      Id<"users">,
      {
        key: Id<"users">;
        userId: Id<"users">;
        displayName: string | null;
        wins: number;
        top3: number;
        games: number;
        score: number;
      }
    >();

    for (const row of withUsers) {
      const prev = grouped.get(row.userId!) ?? {
        key: row.userId!,
        userId: row.userId!,
        displayName: null,
        wins: 0,
        top3: 0,
        games: 0,
        score: 0,
      };
      prev.wins += row.isWinner ? 1 : 0;
      prev.top3 += row.placement <= 3 ? 1 : 0;
      prev.games += 1;
      prev.score += row.scoreFinal;
      grouped.set(row.userId!, prev);
    }

    const ranked = rankGroupedResults(Array.from(grouped.values())).slice(
      0,
      Math.min(Math.max(Math.floor(args.limit), 1), 50),
    );
    for (const row of ranked) {
      const profile = await ctx.db
        .query("usr_profiles")
        .withIndex("by_userId", (q) => q.eq("userId", row.userId))
        .unique();
      row.displayName = profile?.displayName ?? null;
    }
    return ranked;
  },
});

export const listEmpireNpcLeaderboard = query({
  args: { limit: v.number() },
  handler: async (ctx, args) => {
    const allRows = await ctx.db.query("emp_results").take(512);
    const npcRows = (await attachGameResults(ctx, allRows))
      .filter((row) => row.gameResult.isOfficial && row.npcPlayerKey !== null)
      .map((row) => row as Doc<"emp_results">);
    const grouped = new Map<
      string,
      {
        key: string;
        npcPlayerKey: string;
        latestPlayerName: string | null;
        wins: number;
        top3: number;
        games: number;
        score: number;
      }
    >();

    for (const row of npcRows) {
      const npcPlayerKey = row.npcPlayerKey!;
      const prev = grouped.get(npcPlayerKey) ?? {
        key: npcPlayerKey,
        npcPlayerKey,
        latestPlayerName: row.playerName,
        wins: 0,
        top3: 0,
        games: 0,
        score: 0,
      };
      prev.latestPlayerName = row.playerName ?? prev.latestPlayerName;
      prev.wins += row.isWinner ? 1 : 0;
      prev.top3 += row.placement <= 3 ? 1 : 0;
      prev.games += 1;
      prev.score += row.scoreFinal;
      grouped.set(npcPlayerKey, prev);
    }

    return rankGroupedResults(Array.from(grouped.values())).slice(
      0,
      Math.min(Math.max(Math.floor(args.limit), 1), 50),
    );
  },
});

export const listEmpireStrategyLeaderboard = query({
  args: { limit: v.number() },
  handler: async (ctx, args) => {
    const allRows = await ctx.db.query("emp_results").take(512);
    const strategyRows = (await attachGameResults(ctx, allRows))
      .filter((row) => row.gameResult.isOfficial && row.strategyFingerprint !== null)
      .map((row) => row as Doc<"emp_results">);
    const grouped = new Map<
      string,
      {
        key: string;
        strategyFingerprint: string;
        strategyLibraryKey: string | null;
        strategySourceKind: Doc<"emp_results">["strategySourceKind"];
        sampleStrategySummaryJson: string | null;
        wins: number;
        top3: number;
        games: number;
        score: number;
      }
    >();

    for (const row of strategyRows) {
      const fingerprint = row.strategyFingerprint!;
      const prev = grouped.get(fingerprint) ?? {
        key: fingerprint,
        strategyFingerprint: fingerprint,
        strategyLibraryKey: row.strategyLibraryKey,
        strategySourceKind: row.strategySourceKind,
        sampleStrategySummaryJson: row.strategySummaryJson,
        wins: 0,
        top3: 0,
        games: 0,
        score: 0,
      };
      prev.wins += row.isWinner ? 1 : 0;
      prev.top3 += row.placement <= 3 ? 1 : 0;
      prev.games += 1;
      prev.score += row.scoreFinal;
      grouped.set(fingerprint, prev);
    }

    return rankGroupedResults(Array.from(grouped.values())).slice(
      0,
      Math.min(Math.max(Math.floor(args.limit), 1), 50),
    );
  },
});
