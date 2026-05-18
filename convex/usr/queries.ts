import { query, type QueryCtx } from "../_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import { resolveLoadedGameMode } from "../sim/gameMode";
import { listMissions, mapTierFromMapKey } from "./missionCatalog";
import { getAutomationStrategyByKey, toPublicAutomationStrategy } from "./automationStrategyCatalog";
import { summarizeAutomationStrategy } from "./automationStrategyLibrary";
import { resolvePublisherContentStatus } from "./publisherAccess";

function resolveGameRuntimeVersion(
  runtimeVersion: "v1_empire" | "v2_game_actor" | null | undefined,
): "v1_empire" | "v2_game_actor" {
  return runtimeVersion ?? "v1_empire";
}

async function resolveControlledEmpireIdForRole(
  ctx: QueryCtx,
  params: {
    gameId: Id<"sim_games">;
    runtimeVersion: "v1_empire" | "v2_game_actor";
    userId: Id<"users">;
    role: "observer" | "empire" | "trader" | "admin";
    empireId: Id<"emp_states"> | null;
  },
): Promise<Id<"emp_states"> | null> {
  if (params.role !== "empire") {
    return null;
  }
  if (params.empireId !== null) {
    return params.empireId;
  }
  if (params.runtimeVersion !== "v2_game_actor") {
    return null;
  }

  const actor = await ctx.db
    .query("sim_game_actors")
    .withIndex("by_gameId_and_controllerUserId", (q) =>
      q.eq("gameId", params.gameId).eq("controllerUserId", params.userId),
    )
    .unique();
  return actor?.legacyEmpireId ?? null;
}

async function getActorForRole(
  ctx: QueryCtx,
  params: {
    gameId: Id<"sim_games">;
    runtimeVersion: "v1_empire" | "v2_game_actor";
    empireId: Id<"emp_states"> | null;
    userId: Id<"users">;
    role: "observer" | "empire" | "trader" | "admin";
  },
) {
  if (params.runtimeVersion !== "v2_game_actor") {
    return null;
  }

  if (params.role === "empire" && params.empireId !== null) {
    return await ctx.db
      .query("sim_game_actors")
      .withIndex("by_gameId_and_legacyEmpireId", (q) =>
        q.eq("gameId", params.gameId).eq("legacyEmpireId", params.empireId),
      )
      .unique();
  }

  return await ctx.db
    .query("sim_game_actors")
    .withIndex("by_gameId_and_controllerUserId", (q) =>
      q.eq("gameId", params.gameId).eq("controllerUserId", params.userId),
    )
    .unique();
}

type EmpireResultWithGameMeta = Doc<"emp_results"> & {
  gameResult: {
    endedAt: number;
    isOfficial: boolean;
    mapKey: string;
    missionKey: string | null;
    lobbyScenarioKey: string | null;
  };
};

type EmpireResultWithEmbeddedGameMeta = Doc<"emp_results"> & {
  gameEndedAt: number;
  gameIsOfficial: boolean;
  gameMapKey: string;
  gameMissionKey: string | null;
  gameLobbyScenarioKey: string | null;
};

function hasEmbeddedGameMetadata(
  row: Doc<"emp_results">,
): row is EmpireResultWithEmbeddedGameMeta {
  return (
    row.gameEndedAt !== undefined &&
    row.gameIsOfficial !== undefined &&
    row.gameMapKey !== undefined &&
    row.gameMissionKey !== undefined &&
    row.gameLobbyScenarioKey !== undefined
  );
}

async function attachGameMetadata(
  ctx: QueryCtx,
  rows: Doc<"emp_results">[],
): Promise<EmpireResultWithGameMeta[]> {
  const gameResultMap = new Map<Id<"sim_game_results">, Doc<"sim_game_results">>();
  const missingGameResultIds: Id<"sim_game_results">[] = [];
  for (const row of rows) {
    if (hasEmbeddedGameMetadata(row)) {
      continue;
    }
    if (gameResultMap.has(row.gameResultId)) continue;
    gameResultMap.set(row.gameResultId, null as never);
    missingGameResultIds.push(row.gameResultId);
  }
  const gameResults = await Promise.all(
    missingGameResultIds.map((gameResultId) => ctx.db.get("sim_game_results", gameResultId)),
  );
  for (const [index, gameResultId] of missingGameResultIds.entries()) {
    const gameResult = gameResults[index];
    if (gameResult !== null) {
      gameResultMap.set(gameResultId, gameResult);
    }
  }
  return rows.flatMap((row) => {
    if (hasEmbeddedGameMetadata(row)) {
      return [
        {
          ...row,
          gameResult: {
            endedAt: row.gameEndedAt,
            isOfficial: row.gameIsOfficial,
            mapKey: row.gameMapKey,
            missionKey: row.gameMissionKey,
            lobbyScenarioKey: row.gameLobbyScenarioKey,
          },
        },
      ];
    }
    const gameResult = gameResultMap.get(row.gameResultId);
    return gameResult === undefined
      ? []
      : [
          {
            ...row,
            gameResult: {
              endedAt: gameResult.endedAt,
              isOfficial: gameResult.isOfficial,
              mapKey: gameResult.mapKey,
              missionKey: gameResult.missionKey ?? null,
              lobbyScenarioKey: gameResult.lobbyScenarioKey,
            },
          },
        ];
  });
}

async function listOfficialEmpireResults(
  ctx: QueryCtx,
  limit: number,
): Promise<EmpireResultWithGameMeta[]> {
  const indexedRows = await ctx.db
    .query("emp_results")
    .withIndex("by_gameIsOfficial", (q) => q.eq("gameIsOfficial", true))
    .take(limit);
  const legacyCandidates = await ctx.db.query("emp_results").take(limit);
  const legacyRows = (await attachGameMetadata(ctx, legacyCandidates)).filter(
    (row) => row.gameIsOfficial === undefined && row.gameResult.isOfficial,
  );

  const rowsById = new Map<string, EmpireResultWithGameMeta>();
  for (const row of await attachGameMetadata(ctx, indexedRows)) {
    rowsById.set(row._id, row);
  }
  for (const row of legacyRows) {
    if (!rowsById.has(row._id)) {
      rowsById.set(row._id, row);
    }
  }
  return Array.from(rowsById.values());
}

async function listOfficialWinningEmpireResultsForUser(
  ctx: QueryCtx,
  userId: Id<"users">,
  limit: number,
): Promise<EmpireResultWithGameMeta[]> {
  const indexedRows = await ctx.db
    .query("emp_results")
    .withIndex("by_userId_and_gameIsOfficial_and_isWinner", (q) =>
      q.eq("userId", userId).eq("gameIsOfficial", true).eq("isWinner", true),
    )
    .take(limit);
  const legacyCandidates = await ctx.db
    .query("emp_results")
    .withIndex("by_userId_and_isWinner", (q) => q.eq("userId", userId).eq("isWinner", true))
    .take(limit);
  const legacyRows = (await attachGameMetadata(ctx, legacyCandidates)).filter(
    (row) => row.gameIsOfficial === undefined && row.gameResult.isOfficial,
  );

  const rowsById = new Map<string, EmpireResultWithGameMeta>();
  for (const row of await attachGameMetadata(ctx, indexedRows)) {
    rowsById.set(row._id, row);
  }
  for (const row of legacyRows) {
    if (!rowsById.has(row._id)) {
      rowsById.set(row._id, row);
    }
  }
  return Array.from(rowsById.values());
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

function buildResultControllerLabel(params: {
  controllerKind: "human" | "npc";
  playerName: string | null;
  npcPlayerKey: string | null;
}): string {
  if (params.controllerKind === "human") {
    return params.playerName ?? "Human";
  }
  return params.playerName ?? params.npcPlayerKey ?? "NPC";
}

function buildResultIdentityLabel(params: {
  empireName: string;
  controllerLabel: string | null;
  actorDisplayName: string | null;
  actorLabel: string | null;
}): string {
  const suffixParts = [params.actorDisplayName, params.actorLabel, params.controllerLabel].filter(
    (value, index, values): value is string =>
      value !== null && value !== params.empireName && values.indexOf(value) === index,
  );
  return suffixParts.length === 0
    ? params.empireName
    : `${params.empireName} (${suffixParts.join(" · ")})`;
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

    const [profile, passwordAccount] = await Promise.all([
      ctx.db
        .query("usr_profiles")
        .withIndex("by_userId", (q) => q.eq("userId", userId))
        .unique(),
      ctx.db
        .query("authAccounts")
        .withIndex("providerAndAccountId", (q) =>
          q.eq("provider", "password").eq("providerAccountId", (user.email ?? "").toLowerCase()),
        )
        .unique(),
    ]);

    return {
      user: {
        _id: user._id,
        email: user.email ?? null,
        name: user.name ?? null,
        image: user.image ?? null,
        isAnonymous: user.isAnonymous ?? false,
        admin: user.admin ?? false,
        publisher: user.publisher ?? false,
        plan: user.plan ?? "free",
      },
      profile,
      hasPasswordAccount: passwordAccount?.userId === user._id,
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

export const getMyGameMembership = query({
  args: { gameId: v.id("sim_games") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      return null;
    }

    const [role, game] = await Promise.all([
      ctx.db
        .query("usr_game_roles")
        .withIndex("by_gameId_and_userId", (q) =>
          q.eq("gameId", args.gameId).eq("userId", userId),
        )
        .unique(),
      ctx.db.get("sim_games", args.gameId),
    ]);
    const runtimeVersion = resolveGameRuntimeVersion(game?.runtimeVersion);

    if (role === null || !role.isActive) {
      return {
        runtimeVersion,
        role: null,
        actorId: null,
        actorSlotNumber: null,
        actorLabel: null,
        actorDisplayName: null,
        empireId: null,
        empireName: null,
        isEmpirePlayer: false,
        isSpectator: true,
      };
    }

    const actor = await getActorForRole(ctx, {
      gameId: args.gameId,
      runtimeVersion,
      empireId: role.empireId,
      userId,
      role: role.role,
    });
    const effectiveEmpireId = role.empireId ?? actor?.legacyEmpireId ?? null;
    const empire =
      effectiveEmpireId === null ? null : await ctx.db.get("emp_states", effectiveEmpireId);
    const isEmpirePlayer = role.role === "empire" && effectiveEmpireId !== null && empire !== null;

    return {
      runtimeVersion,
      role: role.role,
      actorId: actor?._id ?? null,
      actorSlotNumber: actor?.slotNumber ?? null,
      actorLabel: actor?.factionLabelSnapshot ?? null,
      actorDisplayName: actor?.displayNameSnapshot ?? null,
      empireId: effectiveEmpireId,
      empireName: empire?.name ?? null,
      isEmpirePlayer,
      isSpectator: role.role === "observer" || !isEmpirePlayer,
    };
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

    const game = await ctx.db.get("sim_games", args.gameId);
    const runtimeVersion = resolveGameRuntimeVersion(game?.runtimeVersion);

    const roleRows = await Promise.all(
      (["admin", "empire", "trader", "observer"] as const).map((role) =>
        ctx.db
          .query("usr_game_roles")
          .withIndex("by_gameId_and_role", (q) =>
            q.eq("gameId", args.gameId).eq("role", role),
          )
          .take(args.limit),
      ),
    );
    const roles = roleRows.flat();

    const activeRoles = roles.filter((role) => role.isActive).slice(0, args.limit);
    return await Promise.all(
      activeRoles.map(async (role) => {
        const [profile, actor] = await Promise.all([
          ctx.db
            .query("usr_profiles")
            .withIndex("by_userId", (q) => q.eq("userId", role.userId))
            .unique(),
          getActorForRole(ctx, {
            gameId: args.gameId,
            runtimeVersion,
            empireId: role.empireId,
            userId: role.userId,
            role: role.role,
          }),
        ]);
        return {
        roleId: role._id,
        userId: role.userId,
        runtimeVersion,
        role: role.role,
        actorId: actor?._id ?? null,
        actorSlotNumber: actor?.slotNumber ?? null,
        actorLabel: actor?.factionLabelSnapshot ?? null,
        actorDisplayName: actor?.displayNameSnapshot ?? null,
        empireId: role.empireId,
        displayName: profile?.displayName ?? `Player ${role.userId.slice(-4)}`,
        };
      }),
    );
  },
});

export const getMyLobbyState = query({
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
    const plan = user.plan ?? "free";

    const [currentGames, missions] = await Promise.all([
      ctx.db
        .query("sim_games")
        .withIndex("by_ownerUserId", (q) => q.eq("ownerUserId", userId))
        .collect()
        .then((games) => Promise.all(games.map((game) => resolveLoadedGameMode(ctx, game))))
        .then((games) => games.filter((game): game is NonNullable<typeof game> => game !== null)),
      listMissions(ctx, { publishedOnly: true, fallbackToBuiltIns: true, allowedTier: plan }),
    ]);

    const wins = await listOfficialWinningEmpireResultsForUser(ctx, userId, 256);
    const missionByKey = new Map(missions.map((mission) => [mission.key, mission]));
    const missionWinsByKey = new Map<string, number>();
    const auroraWins = wins.filter((row) => {
      const missionKey = row.gameResult.missionKey ?? row.gameResult.lobbyScenarioKey;
      if (missionKey === null) {
        return false;
      }
      const mission = missionByKey.get(missionKey);
      if (mission === undefined || row.empireKey !== mission.scenario.playerEmpireKey) {
        return false;
      }
      missionWinsByKey.set(missionKey, (missionWinsByKey.get(missionKey) ?? 0) + 1);
      return true;
    });
    const smallWins = auroraWins.filter(
      (row) => mapTierFromMapKey(row.gameResult.mapKey) === "small",
    ).length;
    const mediumWins = auroraWins.filter(
      (row) => mapTierFromMapKey(row.gameResult.mapKey) === "medium",
    ).length;

    const gamesByScenario = new Map(
      currentGames
        .map((game) => [game.missionKey ?? game.lobbyScenarioKey, game] as const)
        .filter((entry): entry is [string, (typeof currentGames)[number]] => entry[0] !== null),
    );
    const memberships = await ctx.db
      .query("usr_game_roles")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .collect();
    const membershipByGameId = new Map(
      memberships.map((membership) => [membership.gameId, membership] as const),
    );

    const resultByGameId = new Map<
      Id<"sim_games">,
      {
        endedAt: number;
        finishReason: Doc<"sim_game_results">["finishReason"];
        winnerEmpireKey: string | null;
        winnerEmpireName: string | null;
        winnerPlayerName: string | null;
        winnerControllerLabel: string | null;
        winnerActorLabel: string | null;
        winnerActorDisplayName: string | null;
        winnerDisplayLabel: string | null;
        auroraPlacement: number | null;
        auroraScoreFinal: number | null;
        auroraStarsControlledFinal: number | null;
        auroraFleetStrengthFinal: number | null;
        auroraWasWinner: boolean;
      }
    >();

    const finishedGameSummaries = await Promise.all(
      currentGames
        .filter((game) => game.status === "finished")
        .map(async (game) => {
          const gameResult = await ctx.db
            .query("sim_game_results")
            .withIndex("by_gameId", (q) => q.eq("gameId", game._id))
            .unique();
          if (gameResult === null) return null;

          const missionKey = gameResult.missionKey ?? gameResult.lobbyScenarioKey;
          const mission = missionKey === null ? null : missionByKey.get(missionKey) ?? null;
          const playerEmpireKey = mission?.scenario.playerEmpireKey ?? "aurora";
          const [winnerRows, auroraRows] = await Promise.all([
            ctx.db
              .query("emp_results")
              .withIndex("by_gameId_and_isWinner", (q) =>
                q.eq("gameId", game._id).eq("isWinner", true),
              )
              .take(1),
            ctx.db
              .query("emp_results")
              .withIndex("by_gameId_and_empireKey", (q) =>
                q.eq("gameId", game._id).eq("empireKey", playerEmpireKey),
              )
              .take(1),
          ]);
          const winner = winnerRows[0] ?? null;
          const aurora = auroraRows[0] ?? null;
          const winnerControllerLabel =
            winner === null
              ? null
              : buildResultControllerLabel({
                  controllerKind: winner.controllerKind,
                  playerName: winner.playerName,
                  npcPlayerKey: winner.npcPlayerKey,
                });

          return {
            gameId: game._id,
            summary: {
              endedAt: gameResult.endedAt,
              finishReason: gameResult.finishReason,
              winnerEmpireKey: winner?.empireKey ?? null,
              winnerEmpireName: winner?.empireName ?? null,
              winnerPlayerName: winner?.playerName ?? null,
              winnerControllerLabel,
              winnerActorLabel: winner?.actorLabel ?? null,
              winnerActorDisplayName: winner?.actorDisplayName ?? null,
              winnerDisplayLabel:
                winner === null
                  ? null
                  : buildResultIdentityLabel({
                      empireName: winner.empireName,
                      controllerLabel: winnerControllerLabel,
                      actorDisplayName: winner.actorDisplayName ?? null,
                      actorLabel: winner.actorLabel ?? null,
                    }),
              auroraPlacement: aurora?.placement ?? null,
              auroraScoreFinal: aurora?.scoreFinal ?? null,
              auroraStarsControlledFinal: aurora?.starsControlledFinal ?? null,
              auroraFleetStrengthFinal: aurora?.fleetStrengthFinal ?? null,
              auroraWasWinner: aurora?.isWinner ?? false,
            },
          };
        }),
    );
    for (const row of finishedGameSummaries) {
      if (row !== null) {
        resultByGameId.set(row.gameId, row.summary);
      }
    }

    return {
      progression: {
        smallWins,
        mediumWins,
        mediumUnlocked: smallWins >= 2,
        largeUnlocked: mediumWins >= 1,
        currentLevel: missions.reduce((level, mission) => {
          const winsForMission = missionWinsByKey.get(mission.key) ?? 0;
          return winsForMission >= mission.requiredWins ? Math.max(level, mission.level + 1) : level;
        }, 1),
        completedMissionCount: missions.filter(
          (mission) => (missionWinsByKey.get(mission.key) ?? 0) >= mission.requiredWins,
        ).length,
        totalMissionCount: missions.length,
      },
      games: missions.map((scenario) => {
        const game = gamesByScenario.get(scenario.key) ?? null;
        const membership = game === null ? null : membershipByGameId.get(game._id) ?? null;
        const unlocked = scenario.prerequisiteMissionKeys.every(
          (missionKey) =>
            (missionWinsByKey.get(missionKey) ?? 0) >= (missionByKey.get(missionKey)?.requiredWins ?? 1),
        );
        return {
          key: scenario.key,
          name: scenario.name,
          description: scenario.description,
          mapKey: scenario.mapKey,
          mapTier: scenario.mapTier,
          level: scenario.level,
          sortOrder: scenario.sortOrder,
          npcCount: scenario.preview.npcEmpireCount,
          requiredWins: scenario.requiredWins,
          winCount: missionWinsByKey.get(scenario.key) ?? 0,
          prerequisiteMissionKeys: scenario.prerequisiteMissionKeys,
          requiredSmallWins: 0,
          requiredMediumWins: 0,
          unlocked,
          game,
          result: game === null ? null : resultByGameId.get(game._id) ?? null,
          isActiveMember: membership?.isActive ?? false,
          myRole: membership?.isActive ? membership.role : null,
        };
      }),
    };
  },
});

export const listPublicAutomationStrategies = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("usr_automation_strategies").take(128);
    return rows
      .filter((row) => row.availableForHumans)
      .filter((row) => resolvePublisherContentStatus({ status: row.status }) === "published")
      .map((row) => toPublicAutomationStrategy(row))
      .sort((left, right) => left.name.localeCompare(right.name));
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
    const sourceLibraryKeys = Array.from(
      new Set(
        rows.flatMap((row) =>
          row.sourceLibraryKey !== undefined ? [row.sourceLibraryKey] : [],
        ),
      ),
    );
    const sourceLibraries = await Promise.all(
      sourceLibraryKeys.map((key) => getAutomationStrategyByKey(ctx, key)),
    );
    const sourceLibraryByKey = new Map(
      sourceLibraryKeys.map((key, index) => [key, sourceLibraries[index] ?? null]),
    );

    return await Promise.all(
      rows
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .map(async (row) => {
          const sourceLibrary =
            row.sourceLibraryKey !== undefined
              ? sourceLibraryByKey.get(row.sourceLibraryKey) ?? null
              : null;

          return {
            ...row,
            sourceLibrary: sourceLibrary === null ? null : toPublicAutomationStrategy(sourceLibrary),
            automationPreview: summarizeAutomationStrategy(row.strategyJson),
          };
        }),
    );
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

    const sourceLibrary =
      profile.sourceLibraryKey !== undefined
        ? await getAutomationStrategyByKey(ctx, profile.sourceLibraryKey)
        : null;

    return {
      ...profile,
      sourceLibrary: sourceLibrary === null ? null : toPublicAutomationStrategy(sourceLibrary),
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

    const game = await ctx.db.get("sim_games", args.gameId);
    const runtimeVersion = resolveGameRuntimeVersion(game?.runtimeVersion);

    const role = await ctx.db
      .query("usr_game_roles")
      .withIndex("by_gameId_and_userId", (q) =>
        q.eq("gameId", args.gameId).eq("userId", userId),
      )
      .unique();

    if (role === null || !role.isActive) {
      return null;
    }

    const empireId = await resolveControlledEmpireIdForRole(ctx, {
      gameId: args.gameId,
      runtimeVersion,
      userId,
      role: role.role,
      empireId: role.empireId,
    });
    if (empireId === null) {
      return null;
    }

    const empire = await ctx.db.get("emp_states", empireId);
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
      standingOrdersRefreshRequestedAt: empire.standingOrdersRefreshRequestedAt ?? null,
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
    const winnerRows = await Promise.all(
      gameResults.map((gameResult) =>
        gameResult.winnerEmpireResultId === null
          ? Promise.resolve(null)
          : ctx.db.get("emp_results", gameResult.winnerEmpireResultId),
      ),
    );

    const results = [] as Array<{
      gameId: Id<"sim_games">;
      urlCode: string | null;
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
        controllerLabel: string;
        actorId: Id<"sim_game_actors"> | null;
        actorSlotNumber: number | null;
        actorLabel: string | null;
        actorDisplayName: string | null;
        scoreFinal: number;
        starsControlledFinal: number;
        fleetStrengthFinal: number;
        strategySummaryJson: string | null;
      } | null;
    }>;

    for (const [index, gameResult] of gameResults.entries()) {
      const winner = winnerRows[index] ?? null;
      results.push({
        gameId: gameResult.gameId,
        urlCode: gameResult.urlCode ?? null,
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
                controllerLabel: buildResultControllerLabel({
                  controllerKind: winner.controllerKind,
                  playerName: winner.playerName,
                  npcPlayerKey: winner.npcPlayerKey,
                }),
                actorId: winner.actorId ?? null,
                actorSlotNumber: winner.actorSlotNumber ?? null,
                actorLabel: winner.actorLabel ?? null,
                actorDisplayName: winner.actorDisplayName ?? null,
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
    const officialRows = await listOfficialEmpireResults(ctx, 512);
    const withUsers = officialRows.filter((row) => row.userId !== null);
    const grouped = new Map<
      Id<"users">,
      {
        key: Id<"users">;
        userId: Id<"users">;
        displayName: string | null;
        latestActorId: Id<"sim_game_actors"> | null;
        latestActorSlotNumber: number | null;
        latestActorLabel: string | null;
        latestActorDisplayName: string | null;
        latestEndedAt: number;
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
        latestActorId: null,
        latestActorSlotNumber: null,
        latestActorLabel: null,
        latestActorDisplayName: null,
        latestEndedAt: 0,
        wins: 0,
        top3: 0,
        games: 0,
        score: 0,
      };
      if (row.gameResult.endedAt >= prev.latestEndedAt) {
        prev.latestEndedAt = row.gameResult.endedAt;
        prev.latestActorId = row.actorId ?? null;
        prev.latestActorSlotNumber = row.actorSlotNumber ?? null;
        prev.latestActorLabel = row.actorLabel ?? null;
        prev.latestActorDisplayName = row.actorDisplayName ?? null;
      }
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
    const profiles = await Promise.all(
      ranked.map((row) =>
        ctx.db
          .query("usr_profiles")
          .withIndex("by_userId", (q) => q.eq("userId", row.userId))
          .unique(),
      ),
    );
    for (const [index, row] of ranked.entries()) {
      row.displayName = profiles[index]?.displayName ?? null;
    }
    return ranked;
  },
});

export const listEmpireNpcLeaderboard = query({
  args: { limit: v.number() },
  handler: async (ctx, args) => {
    const npcRows = (await listOfficialEmpireResults(ctx, 512)).filter(
      (row) => row.npcPlayerKey !== null,
    );
    const grouped = new Map<
      string,
      {
        key: string;
        npcPlayerKey: string;
        latestPlayerName: string | null;
        latestActorId: Id<"sim_game_actors"> | null;
        latestActorSlotNumber: number | null;
        latestActorLabel: string | null;
        latestActorDisplayName: string | null;
        latestEndedAt: number;
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
        latestActorId: null,
        latestActorSlotNumber: null,
        latestActorLabel: null,
        latestActorDisplayName: null,
        latestEndedAt: 0,
        wins: 0,
        top3: 0,
        games: 0,
        score: 0,
      };
      prev.latestPlayerName = row.playerName ?? prev.latestPlayerName;
      if (row.gameResult.endedAt >= prev.latestEndedAt) {
        prev.latestEndedAt = row.gameResult.endedAt;
        prev.latestActorId = row.actorId ?? null;
        prev.latestActorSlotNumber = row.actorSlotNumber ?? null;
        prev.latestActorLabel = row.actorLabel ?? null;
        prev.latestActorDisplayName = row.actorDisplayName ?? null;
      }
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
    const strategyRows = (await listOfficialEmpireResults(ctx, 512)).filter(
      (row) => row.strategyFingerprint !== null,
    );
    const grouped = new Map<
      string,
      {
        key: string;
        strategyFingerprint: string;
        strategyLibraryKey: string | null;
        strategySourceKind: Doc<"emp_results">["strategySourceKind"];
        sampleStrategySummaryJson: string | null;
        latestActorId: Id<"sim_game_actors"> | null;
        latestActorSlotNumber: number | null;
        latestActorLabel: string | null;
        latestActorDisplayName: string | null;
        latestControllerLabel: string | null;
        latestEndedAt: number;
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
        latestActorId: null,
        latestActorSlotNumber: null,
        latestActorLabel: null,
        latestActorDisplayName: null,
        latestControllerLabel: null,
        latestEndedAt: 0,
        wins: 0,
        top3: 0,
        games: 0,
        score: 0,
      };
      if (row.gameResult.endedAt >= prev.latestEndedAt) {
        prev.latestEndedAt = row.gameResult.endedAt;
        prev.latestActorId = row.actorId ?? null;
        prev.latestActorSlotNumber = row.actorSlotNumber ?? null;
        prev.latestActorLabel = row.actorLabel ?? null;
        prev.latestActorDisplayName = row.actorDisplayName ?? null;
        prev.latestControllerLabel = buildResultControllerLabel({
          controllerKind: row.controllerKind,
          playerName: row.playerName,
          npcPlayerKey: row.npcPlayerKey,
        });
      }
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
