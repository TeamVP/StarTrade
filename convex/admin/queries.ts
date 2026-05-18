import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { query, type QueryCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { getAutomationStrategyByKey, toAutomationStrategyCatalogRow } from "../usr/automationStrategyCatalog";
import { listMissions as listMissionCatalogRows } from "../usr/missionCatalog";
import { listNpcEmpirePlayers } from "../seed/npcEmpirePlayers";
import { TRADER_EVENT_TYPES } from "../sim/eventTypePolicies";
import {
  gameUsesTraderEconomy,
  loadGameWithResolvedMode,
  resolveGameMode,
  resolveLoadedGameMode,
} from "../sim/gameMode";

async function loadOwnerLabels(
  ctx: QueryCtx,
  ownerIds: Array<Id<"users"> | null>,
) {
  const uniqueOwnerIds = Array.from(new Set(ownerIds.filter((ownerId): ownerId is Id<"users"> => ownerId !== null)));
  const owners = await Promise.all(uniqueOwnerIds.map((ownerId) => ctx.db.get("users", ownerId)));
  return new Map(
    uniqueOwnerIds.map((ownerId, index) => {
      const user = owners[index] ?? null;
      return [ownerId, user?.name ?? user?.email ?? null] as const;
    }),
  );
}

async function loadRecentModerationEvents(
  ctx: QueryCtx,
  args: {
    contentType: "mission" | "strategy";
    contentKeys: string[];
    limitPerContent?: number;
  },
) {
  const limitPerContent = Math.min(Math.max(args.limitPerContent ?? 3, 1), 5);
  const uniqueContentKeys = Array.from(new Set(args.contentKeys));
  const eventRows = await Promise.all(
    uniqueContentKeys.map(async (contentKey) => ({
      contentKey,
      events: await ctx.db
        .query("admin_content_moderation_events")
        .withIndex("by_contentType_and_contentKey_and_createdAt", (q) =>
          q.eq("contentType", args.contentType).eq("contentKey", contentKey),
        )
        .order("desc")
        .take(limitPerContent),
    })),
  );

  const actorIds = Array.from(
    new Set(
      eventRows.flatMap((row) => row.events.map((event) => event.actorUserId)),
    ),
  );
  const actorUsers = await Promise.all(actorIds.map((actorUserId) => ctx.db.get("users", actorUserId)));
  const actorLabels = new Map(
    actorIds.map((actorUserId, index) => {
      const user = actorUsers[index] ?? null;
      return [actorUserId, user?.name ?? user?.email ?? null] as const;
    }),
  );

  return new Map(
    eventRows.map((row) => [
      row.contentKey,
      row.events.map((event) => ({
        action: event.action,
        summary: event.summary,
        note: event.note ?? null,
        createdAt: event.createdAt,
        actorLabel: actorLabels.get(event.actorUserId) ?? null,
      })),
    ] as const),
  );
}

export const listUsers = query({
  args: {
    limit: v.number(),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      return { authorized: false, users: [] };
    }

    const limit = Math.min(Math.max(Math.floor(args.limit), 1), 100);
    const users = await ctx.db.query("users").order("desc").take(limit);
    const mappedUsers = await Promise.all(
      users.map(async (user) => {
        const email = user.email?.toLowerCase();
        const passwordAccount =
          email === undefined
            ? null
            : await ctx.db
                .query("authAccounts")
                .withIndex("providerAndAccountId", (q) =>
                  q.eq("provider", "password").eq("providerAccountId", email),
                )
                .unique();

        return {
          _id: user._id,
          createdAt: user._creationTime,
          name: user.name ?? null,
          email: user.email ?? null,
          phone: user.phone ?? null,
          image: user.image ?? null,
          emailVerificationTime: user.emailVerificationTime ?? null,
          phoneVerificationTime: user.phoneVerificationTime ?? null,
          isAnonymous: user.isAnonymous ?? false,
          admin: user.admin ?? false,
          publisher: user.publisher ?? false,
          plan: user.plan ?? "free",
          hasPasswordAccount: passwordAccount?.userId === user._id,
        };
      }),
    );

    return {
      authorized: true,
      users: mappedUsers,
    };
  },
});

export const getDatabaseHealth = query({
  args: {
    gameId: v.optional(v.id("sim_games")),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      return { authorized: false as const };
    }

    const SAMPLE_GAMES_LIMIT = 100;
    const TABLE_SAMPLE_LIMIT = 512;

    const games = await ctx.db.query("sim_games").order("desc").take(SAMPLE_GAMES_LIMIT);

    const statusCounts = {
      lobby: 0,
      running: 0,
      paused: 0,
      finished: 0,
    };
    const retentionCounts = {
      official: 0,
      discarded: 0,
      archived_debug: 0,
      unknown: 0,
    };
    const finalizationCounts = {
      none: 0,
      pending_result_write: 0,
      results_written: 0,
      pending_cleanup: 0,
      cleaned: 0,
      archived_debug: 0,
      unknown: 0,
    };

    for (const game of games) {
      statusCounts[game.status] += 1;
      const retention = game.retentionClass;
      if (retention === undefined) {
        retentionCounts.unknown += 1;
      } else {
        retentionCounts[retention] += 1;
      }

      const finalizationState = game.finalizationState;
      if (finalizationState === undefined) {
        finalizationCounts.unknown += 1;
      } else {
        finalizationCounts[finalizationState] += 1;
      }
    }

    const users = await ctx.db.query("users").order("desc").take(SAMPLE_GAMES_LIMIT);
    const missions = await ctx.db.query("sim_missions").collect();
    const strategies = await ctx.db.query("usr_automation_strategies").collect();
    const metadataSweepState = await ctx.db
      .query("admin_metadata_backfill_state")
      .withIndex("by_key", (q) => q.eq("key", "default"))
      .unique();
    const metadataCounts = {
      missingGameMode: games.filter((game) => game.mode === undefined).length,
      missingUserPlan: users.filter((user) => user.plan === undefined).length,
      missingUserPublisher: users.filter((user) => user.publisher === undefined).length,
      missingMissionMode: missions.filter((mission) => mission.mode === undefined).length,
      missingMissionRequiredTier: missions.filter((mission) => mission.requiredTier === undefined).length,
      missingMissionSource: missions.filter((mission) => mission.source === undefined).length,
      missingMissionReviewStatus: missions.filter((mission) => mission.reviewStatus === undefined).length,
      missingMissionStatus: missions.filter((mission) => mission.status === undefined).length,
      missingStrategySource: strategies.filter((strategy) => strategy.source === undefined).length,
      missingStrategyReviewStatus: strategies.filter((strategy) => strategy.reviewStatus === undefined).length,
      missingStrategyStatus: strategies.filter((strategy) => strategy.status === undefined).length,
    };

    const cleanupCandidates = games
      .filter((game) => {
        if (game.status === "finished") {
          return (
            game.finalizationState === undefined ||
            game.finalizationState === "none" ||
            game.finalizationState === "pending_result_write" ||
            game.finalizationState === "results_written"
          );
        }
        return game.status === "running" || game.status === "paused";
      })
      .slice(0, 20)
      .map((game) => ({
        gameId: game._id,
        urlCode: game.urlCode ?? null,
        name: game.name,
        status: game.status,
        currentTurn: game.currentTurn,
        retentionClass: game.retentionClass ?? null,
        finalizationState: game.finalizationState ?? null,
        cleanupQueuedAt: game.cleanupQueuedAt ?? null,
        cleanupCompletedAt: game.cleanupCompletedAt ?? null,
        lastMeaningfulActivityAt: game.lastMeaningfulActivityAt ?? null,
        abandonmentEligibleAt: game.abandonmentEligibleAt ?? null,
      }));

    const selectedGame =
      args.gameId === undefined
        ? await resolveLoadedGameMode(ctx, games[0] ?? null)
        : await resolveLoadedGameMode(
            ctx,
            games.find((game) => game._id === args.gameId) ??
              (await loadGameWithResolvedMode(ctx, args.gameId)),
          );

    function boundedCountFromRows<T extends { length: number }>(rows: T) {
      return {
        count: Math.min(rows.length, TABLE_SAMPLE_LIMIT),
        capped: rows.length > TABLE_SAMPLE_LIMIT,
      };
    }

    function subtractTableStats(
      total: { count: number; capped: boolean },
      subset: { count: number; capped: boolean },
    ) {
      return {
        // These are sampled counts already, so clamp at zero when the sampled subset
        // consumes the visible total bucket.
        count: Math.max(0, total.count - subset.count),
        capped: total.capped,
      };
    }

    const disabledTableStat = {
      count: 0,
      capped: false,
      disabled: true as const,
    };

    async function countLegacySimTraderIdentities(
      gameId: NonNullable<typeof selectedGame>["_id"],
    ) {
      return boundedCountFromRows(
        await ctx.db
          .query("sim_trader_identities")
          .withIndex("by_gameId", (q) => q.eq("gameId", gameId))
          .take(TABLE_SAMPLE_LIMIT + 1),
      );
    }

    async function countLegacyEcoMarketSnapshots(
      gameId: NonNullable<typeof selectedGame>["_id"],
    ) {
      return boundedCountFromRows(
        await ctx.db
          .query("eco_market_snapshots")
          .withIndex("by_gameId_and_turnNumber", (q) => q.eq("gameId", gameId))
          .take(TABLE_SAMPLE_LIMIT + 1),
      );
    }

    async function countLegacyEcoBgTraders(
      gameId: NonNullable<typeof selectedGame>["_id"],
    ) {
      return boundedCountFromRows(
        await ctx.db
          .query("eco_bg_traders")
          .withIndex("by_gameId_and_status", (q) => q.eq("gameId", gameId))
          .take(TABLE_SAMPLE_LIMIT + 1),
      );
    }

    async function countLegacyTrdCharters(
      gameId: NonNullable<typeof selectedGame>["_id"],
    ) {
      return boundedCountFromRows(
        await ctx.db
          .query("trd_charters")
          .withIndex("by_gameId_and_status", (q) => q.eq("gameId", gameId))
          .take(TABLE_SAMPLE_LIMIT + 1),
      );
    }

    async function countLegacyTrdRuns(
      gameId: NonNullable<typeof selectedGame>["_id"],
    ) {
      return boundedCountFromRows(
        await ctx.db
          .query("trd_runs")
          .withIndex("by_gameId_and_turnNumber", (q) => q.eq("gameId", gameId))
          .take(TABLE_SAMPLE_LIMIT + 1),
      );
    }

    async function countLegacyTraderEvents(
      gameId: NonNullable<typeof selectedGame>["_id"],
    ) {
      let count = 0;
      let capped = false;
      for (const eventType of TRADER_EVENT_TYPES) {
        const rows = await ctx.db
          .query("sim_events")
          .withIndex("by_gameId_and_eventType", (q) =>
            q.eq("gameId", gameId).eq("eventType", eventType),
          )
          .take(TABLE_SAMPLE_LIMIT + 1);
        count += Math.min(rows.length, TABLE_SAMPLE_LIMIT + 1);
        capped ||= rows.length > TABLE_SAMPLE_LIMIT;
      }
      return {
        count: Math.min(count, TABLE_SAMPLE_LIMIT),
        capped: capped || count > TABLE_SAMPLE_LIMIT,
      };
    }

    const selectedGameUsesTraderEconomy =
      selectedGame !== null && gameUsesTraderEconomy(selectedGame);
    const selectedGameLegacyTraderEvents =
      selectedGame !== null && !selectedGameUsesTraderEconomy
        ? await countLegacyTraderEvents(selectedGame._id)
        : undefined;
    const selectedGameSimEvents =
      selectedGame === null
        ? undefined
        : boundedCountFromRows(
            await ctx.db
              .query("sim_events")
              .withIndex("by_gameId", (q) => q.eq("gameId", selectedGame._id))
              .take(TABLE_SAMPLE_LIMIT + 1),
          );

    const selectedGameTableStats =
      selectedGame === null
        ? null
        : {
            gameId: selectedGame._id,
            urlCode: selectedGame.urlCode ?? null,
            name: selectedGame.name,
            mode: resolveGameMode(selectedGame.mode),
          runtimeVersion: selectedGame.runtimeVersion ?? "v1_empire",
            status: selectedGame.status,
            currentTurn: selectedGame.currentTurn,
            retentionClass: selectedGame.retentionClass ?? null,
            finalizationState: selectedGame.finalizationState ?? null,
            simEvents:
              selectedGameUsesTraderEconomy || selectedGameLegacyTraderEvents === undefined
                ? selectedGameSimEvents!
                : subtractTableStats(selectedGameSimEvents!, selectedGameLegacyTraderEvents),
            simTurns: boundedCountFromRows(
              await ctx.db
                .query("sim_turns")
                .withIndex("by_gameId", (q) => q.eq("gameId", selectedGame._id))
                .take(TABLE_SAMPLE_LIMIT + 1),
            ),
            simGameActors: boundedCountFromRows(
              await ctx.db
                .query("sim_game_actors")
                .withIndex("by_gameId", (q) => q.eq("gameId", selectedGame._id))
                .take(TABLE_SAMPLE_LIMIT + 1),
            ),
            simTurnPreparations: boundedCountFromRows(
              await ctx.db
                .query("sim_turn_preparations")
                .withIndex("by_gameId", (q) => q.eq("gameId", selectedGame._id))
                .take(TABLE_SAMPLE_LIMIT + 1),
            ),
            simTurnPreparationOps: boundedCountFromRows(
              await ctx.db
                .query("sim_turn_preparation_ops")
                .withIndex("by_gameId_and_turnNumber", (q) => q.eq("gameId", selectedGame._id))
                .take(TABLE_SAMPLE_LIMIT + 1),
            ),
            galSystems: boundedCountFromRows(
              await ctx.db
                .query("gal_systems")
                .withIndex("by_gameId", (q) => q.eq("gameId", selectedGame._id))
                .take(TABLE_SAMPLE_LIMIT + 1),
            ),
            galLinks: boundedCountFromRows(
              await ctx.db
                .query("gal_links")
                .withIndex("by_gameId", (q) => q.eq("gameId", selectedGame._id))
                .take(TABLE_SAMPLE_LIMIT + 1),
            ),
            empStates: boundedCountFromRows(
              await ctx.db
                .query("emp_states")
                .withIndex("by_gameId", (q) => q.eq("gameId", selectedGame._id))
                .take(TABLE_SAMPLE_LIMIT + 1),
            ),
            empSystemHoldings: boundedCountFromRows(
              await ctx.db
                .query("emp_system_holdings")
                .withIndex("by_gameId", (q) => q.eq("gameId", selectedGame._id))
                .take(TABLE_SAMPLE_LIMIT + 1),
            ),
            empPriorityStars: boundedCountFromRows(
              await ctx.db
                .query("emp_priority_stars")
                .withIndex("by_gameId", (q) => q.eq("gameId", selectedGame._id))
                .take(TABLE_SAMPLE_LIMIT + 1),
            ),
            fltFleets: boundedCountFromRows(
              await ctx.db
                .query("flt_fleets")
                .withIndex("by_gameId", (q) => q.eq("gameId", selectedGame._id))
                .take(TABLE_SAMPLE_LIMIT + 1),
            ),
            fltOrdersCurrentTurn: boundedCountFromRows(
              await ctx.db
                .query("flt_orders")
                .withIndex("by_gameId_and_turnNumber", (q) =>
                  q.eq("gameId", selectedGame._id).eq("turnNumber", selectedGame.currentTurn),
                )
                .take(TABLE_SAMPLE_LIMIT + 1),
            ),
            fltGarrisonRoutes: boundedCountFromRows(
              await ctx.db
                .query("flt_garrison_routes")
                .withIndex("by_gameId", (q) => q.eq("gameId", selectedGame._id))
                .take(TABLE_SAMPLE_LIMIT + 1),
            ),
            colonyShips: boundedCountFromRows(
              await ctx.db
                .query("col_colony_ships")
                .withIndex("by_gameId", (q) => q.eq("gameId", selectedGame._id))
                .take(TABLE_SAMPLE_LIMIT + 1),
            ),
            cmbBattles: boundedCountFromRows(
              await ctx.db
                .query("cmb_battles")
                .withIndex("by_gameId", (q) => q.eq("gameId", selectedGame._id))
                .take(TABLE_SAMPLE_LIMIT + 1),
            ),
            ecoMarketSnapshots: gameUsesTraderEconomy(selectedGame)
              ? boundedCountFromRows(
                  await ctx.db
                    .query("eco_market_snapshots")
                    .withIndex("by_gameId_and_turnNumber", (q) => q.eq("gameId", selectedGame._id))
                    .take(TABLE_SAMPLE_LIMIT + 1),
                )
              : disabledTableStat,
            ecoBgTraders: gameUsesTraderEconomy(selectedGame)
              ? boundedCountFromRows(
                  await ctx.db
                    .query("eco_bg_traders")
                    .withIndex("by_gameId_and_status", (q) => q.eq("gameId", selectedGame._id))
                    .take(TABLE_SAMPLE_LIMIT + 1),
                )
              : disabledTableStat,
            simGameResults: boundedCountFromRows(
              await ctx.db
                .query("sim_game_results")
                .withIndex("by_gameId", (q) => q.eq("gameId", selectedGame._id))
                .take(TABLE_SAMPLE_LIMIT + 1),
            ),
            empResults: boundedCountFromRows(
              await ctx.db
                .query("emp_results")
                .withIndex("by_gameId", (q) => q.eq("gameId", selectedGame._id))
                .take(TABLE_SAMPLE_LIMIT + 1),
            ),
            legacyTraderData: selectedGameUsesTraderEconomy
              ? null
              : {
                  simTraderIdentities: await countLegacySimTraderIdentities(
                    selectedGame._id,
                  ),
                  ecoMarketSnapshots: await countLegacyEcoMarketSnapshots(
                    selectedGame._id,
                  ),
                  ecoBgTraders: await countLegacyEcoBgTraders(
                    selectedGame._id,
                  ),
                  simEvents: selectedGameLegacyTraderEvents!,
                  trdCharters: await countLegacyTrdCharters(
                    selectedGame._id,
                  ),
                  trdRuns: await countLegacyTrdRuns(
                    selectedGame._id,
                  ),
                },
          };

    return {
      authorized: true as const,
      scannedGames: games.length,
      selectedGameTableStats,
      overview: {
        statusCounts,
        retentionCounts,
        finalizationCounts,
        metadataCounts,
        metadataSweep: {
          lastRunAt: metadataSweepState?.lastRunAt ?? null,
          lastSweepCompletedAt: metadataSweepState?.lastSweepCompletedAt ?? null,
          lastUpdatedRows: metadataSweepState?.lastUpdatedRows ?? null,
        },
        cleanupCandidates,
        cleanupCandidateCount: cleanupCandidates.length,
      },
    };
  },
});

export const listAutomationStrategies = query({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      return { authorized: false as const, strategies: [] as const };
    }

    const limit = Math.min(Math.max(Math.floor(args.limit ?? 128), 1), 256);
    const strategies = await ctx.db.query("usr_automation_strategies").take(limit);
    const ownerLabels = await loadOwnerLabels(
      ctx,
      strategies.map((row) => row.ownerUserId ?? null),
    );
    const moderationEvents = await loadRecentModerationEvents(ctx, {
      contentType: "strategy",
      contentKeys: strategies.map((row) => row.key),
    });

    return {
      authorized: true as const,
      strategies: strategies
        .map((row) => ({
          ...toAutomationStrategyCatalogRow(row),
          ownerLabel:
            row.ownerUserId === undefined || row.ownerUserId === null
              ? null
              : ownerLabels.get(row.ownerUserId) ?? null,
          moderationHistory: moderationEvents.get(row.key) ?? [],
        }))
        .sort((left, right) => left.name.localeCompare(right.name)),
    };
  },
});

export const listEmpireNpcPlayers = query({
  args: {
    includeInactive: v.optional(v.boolean()),
    fallbackToBuiltIns: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      return { authorized: false as const, empireNpcs: [] as const };
    }

    const players = await listNpcEmpirePlayers(ctx, {
      includeInactive: args.includeInactive ?? true,
      fallbackToBuiltIns: args.fallbackToBuiltIns ?? false,
    });

    return {
      authorized: true as const,
      empireNpcs: await Promise.all(
        players.map(async (player) => {
          const strategy =
            player.strategyLibraryKey === null
              ? null
              : await getAutomationStrategyByKey(ctx, player.strategyLibraryKey);
          return {
            key: player.key,
            playerName: player.playerName,
            empireName: player.empireName,
            colorHex: player.colorHex,
            strategyLibraryKey: player.strategyLibraryKey,
            defaultStrategy:
              strategy === null ? null : toAutomationStrategyCatalogRow(strategy),
            isActive: player.isActive,
            sortOrder: player.sortOrder,
          };
        }),
      ),
    };
  },
});

export const listMissions = query({
  args: {
    publishedOnly: v.optional(v.boolean()),
    fallbackToBuiltIns: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      return { authorized: false as const, missions: [] as const };
    }

    const missions = await listMissionCatalogRows(ctx, {
      publishedOnly: args.publishedOnly ?? false,
      fallbackToBuiltIns: args.fallbackToBuiltIns ?? false,
      includeCommunity: true,
      includeUnpublishedModes: true,
    });
    const ownerLabels = await loadOwnerLabels(
      ctx,
      missions.map((mission) => mission.ownerUserId),
    );
    const moderationEvents = await loadRecentModerationEvents(ctx, {
      contentType: "mission",
      contentKeys: missions.map((mission) => mission.key),
    });

    return {
      authorized: true as const,
      missions: missions.map((mission) => ({
        ...mission,
        ownerLabel:
          mission.ownerUserId === null ? null : ownerLabels.get(mission.ownerUserId) ?? null,
        moderationHistory: moderationEvents.get(mission.key) ?? [],
      })),
    };
  },
});