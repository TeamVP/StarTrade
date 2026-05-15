import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { query } from "../_generated/server";
import { toAutomationStrategyCatalogRow } from "../usr/automationStrategyCatalog";

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
        ? games[0] ?? null
        : games.find((game) => game._id === args.gameId) ?? (await ctx.db.get("sim_games", args.gameId));

    function boundedCountFromRows<T extends { length: number }>(rows: T) {
      return {
        count: Math.min(rows.length, TABLE_SAMPLE_LIMIT),
        capped: rows.length > TABLE_SAMPLE_LIMIT,
      };
    }

    const selectedGameTableStats =
      selectedGame === null
        ? null
        : {
            gameId: selectedGame._id,
          urlCode: selectedGame.urlCode ?? null,
            name: selectedGame.name,
            status: selectedGame.status,
            currentTurn: selectedGame.currentTurn,
            retentionClass: selectedGame.retentionClass ?? null,
            finalizationState: selectedGame.finalizationState ?? null,
            simEvents: boundedCountFromRows(
              await ctx.db
                .query("sim_events")
                .withIndex("by_gameId", (q) => q.eq("gameId", selectedGame._id))
                .take(TABLE_SAMPLE_LIMIT + 1),
            ),
            simTurns: boundedCountFromRows(
              await ctx.db
                .query("sim_turns")
                .withIndex("by_gameId", (q) => q.eq("gameId", selectedGame._id))
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
            ecoMarketSnapshots: boundedCountFromRows(
              await ctx.db
                .query("eco_market_snapshots")
                .withIndex("by_gameId_and_turnNumber", (q) => q.eq("gameId", selectedGame._id))
                .take(TABLE_SAMPLE_LIMIT + 1),
            ),
            ecoSystemOutputs: boundedCountFromRows(
              await ctx.db
                .query("eco_system_outputs")
                .withIndex("by_gameId_and_systemId", (q) => q.eq("gameId", selectedGame._id))
                .take(TABLE_SAMPLE_LIMIT + 1),
            ),
            ecoBgTraders: boundedCountFromRows(
              await ctx.db
                .query("eco_bg_traders")
                .withIndex("by_gameId_and_status", (q) => q.eq("gameId", selectedGame._id))
                .take(TABLE_SAMPLE_LIMIT + 1),
            ),
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
          };

    return {
      authorized: true as const,
      scannedGames: games.length,
      selectedGameTableStats,
      overview: {
        statusCounts,
        retentionCounts,
        finalizationCounts,
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

    return {
      authorized: true as const,
      strategies: strategies
        .map((row) => toAutomationStrategyCatalogRow(row))
        .sort((left, right) => left.name.localeCompare(right.name)),
    };
  },
});