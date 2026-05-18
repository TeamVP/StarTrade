import { query, type QueryCtx } from "../_generated/server";
import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import type { Doc, Id } from "../_generated/dataModel";
import { isSoundscapeEventType, isTraderEventType } from "./eventTypePolicies";
import {
  gameUsesTraderEconomy,
  loadGameWithResolvedMode,
  resolveGameMode,
  resolveLoadedGameMode,
} from "./gameMode";

function resolveGameRuntimeVersion(
  runtimeVersion: "v1_empire" | "v2_game_actor" | null | undefined,
): "v1_empire" | "v2_game_actor" {
  return runtimeVersion ?? "v1_empire";
}

const COMBAT_REPLAY_EVENT_TYPES = new Set([
  "battle_started",
  "battle_round_resolved",
]);

function shouldIncludeEventForGame(game: Doc<"sim_games">, eventType: string): boolean {
  if (gameUsesTraderEconomy(game)) {
    return true;
  }
  return !isTraderEventType(eventType);
}

function filterEventsForGame<T extends { eventType: string }>(
  game: Doc<"sim_games">,
  events: T[],
): T[] {
  if (gameUsesTraderEconomy(game)) {
    return events;
  }
  return events.filter((event) => shouldIncludeEventForGame(game, event.eventType));
}

function filterCombatReplayEvents<T extends { eventType: string }>(events: T[]): T[] {
  return events.filter((event) => COMBAT_REPLAY_EVENT_TYPES.has(event.eventType));
}

function filterSoundscapeEvents<T extends { eventType: string }>(events: T[]): T[] {
  return events.filter((event) => isSoundscapeEventType(event.eventType));
}

function buildTurnWorkLabel(params: {
  turnState: Doc<"sim_turns">["state"] | null | undefined;
  resolutionPhase: string | null | undefined;
}): string | null {
  const { turnState, resolutionPhase } = params;
  if (turnState === null || turnState === undefined) {
    return null;
  }
  if (turnState === "prepared") {
    return "Prepared";
  }
  return resolutionPhase ?? turnState ?? "working";
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

type TurnRow = Doc<"sim_turns"> | null;
type TurnPreparationRow = {
  state: "queued" | "preparing" | "prepared" | "committed" | "stale";
  targetBoundaryAt?: number | null;
  preparedAt?: number | null;
} | null;

function buildTurnTimelineSnapshot(params: {
  game: Doc<"sim_games">;
  turnRow: TurnRow;
  preparationRow: TurnPreparationRow;
}) {
  const { game, turnRow, preparationRow } = params;
  const isTurnBusy = turnRow?.state !== null && turnRow?.state !== "open";
  const isTurnClockActive = game.status === "running" || game.status === "paused";
  const acceptingOrders =
    game.status === "paused" || (game.status === "running" && !isTurnBusy);
  const turnWorkLabel = buildTurnWorkLabel({
    turnState: turnRow?.state,
    resolutionPhase: turnRow?.resolutionPhase,
  });
  return {
    gameStatus: game.status,
    serverNowMs: Date.now(),
    currentTurn: game.currentTurn,
    turnDurationMs: game.turnDurationMs,
    turnStartedAt: turnRow?.startedAt ?? null,
    turnPausedAtMs: game.turnPausedAtMs,
    turnState: turnRow?.state ?? null,
    turnPreparationState: preparationRow?.state ?? null,
    turnPreparationBoundaryAt: preparationRow?.targetBoundaryAt ?? null,
    turnPreparedAtMs: preparationRow?.preparedAt ?? null,
    resolutionPhase: turnRow?.resolutionPhase ?? null,
    turnWorkLabel,
    isTurnBusy,
    isTurnClockActive,
    acceptingOrders,
    simCronTurnsDisabled: game.simCronTurnsDisabled === true,
    turnPausedUntilMs: game.turnPausedUntilMs,
    nextTurnAutoResolveDelayRatio: game.nextTurnAutoResolveDelayRatio,
    nextPreparationWakeAt: game.nextPreparationWakeAt ?? null,
    nextBoundaryWakeAt: game.nextBoundaryWakeAt ?? null,
  };
}

async function listActorsForGame(
  ctx: QueryCtx,
  gameId: Id<"sim_games">,
): Promise<{
  actorById: Map<string, Doc<"sim_game_actors">>;
  actorByLegacyEmpireId: Map<string, Doc<"sim_game_actors">>;
}> {
  const actors = await ctx.db
    .query("sim_game_actors")
    .withIndex("by_gameId", (q) => q.eq("gameId", gameId))
    .take(64);
  return {
    actorById: new Map(actors.map((actor) => [actor._id as string, actor] as const)),
    actorByLegacyEmpireId: new Map(
      actors
        .filter((actor) => actor.legacyEmpireId !== null)
        .map((actor) => [actor.legacyEmpireId as string, actor] as const),
    ),
  };
}

function formatGameActorHistoryLabel(actor: Doc<"sim_game_actors">): string {
  const actorName = actor.displayNameSnapshot.trim();
  return `Actor ${actor.slotNumber}${actorName.length > 0 ? ` · ${actorName}` : ""}`;
}

function parseEventPayload(payload: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(payload);
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function stringField(record: Record<string, unknown> | null, key: string): string | null {
  if (record === null) {
    return null;
  }
  const value = record[key];
  return typeof value === "string" ? value : null;
}

async function attachEventPresentationMetadata(
  ctx: QueryCtx,
  game: Doc<"sim_games">,
  events: Doc<"sim_events">[],
) {
  if (events.length === 0) {
    return events;
  }

  const runtimeVersion = resolveGameRuntimeVersion(game.runtimeVersion);
  const empireIds = new Set<string>();
  const gameActorIds = new Set<string>();
  const systemIds = new Set<string>();

  for (const event of events) {
    const payload = parseEventPayload(event.payload);
    if (event.actorType === "empire") {
      empireIds.add(event.actorId);
    }
    if (event.actorType === "game_actor") {
      gameActorIds.add(event.actorId);
    }
    if (event.targetType === "empire" && event.targetId !== null) {
      empireIds.add(event.targetId);
    }
    if (event.targetType === "game_actor" && event.targetId !== null) {
      gameActorIds.add(event.targetId);
    }
    if (event.actorType === "system") {
      systemIds.add(event.actorId);
    }
    if (event.targetType === "system" && event.targetId !== null) {
      systemIds.add(event.targetId);
    }
    const attackerEmpireId = stringField(payload, "attackerEmpireId");
    const defenderEmpireId = stringField(payload, "defenderEmpireId");
    if (attackerEmpireId !== null) {
      empireIds.add(attackerEmpireId);
    }
    if (defenderEmpireId !== null) {
      empireIds.add(defenderEmpireId);
    }
  }

  const [actors, empires, systems] = await Promise.all([
    runtimeVersion === "v2_game_actor" && (empireIds.size > 0 || gameActorIds.size > 0)
      ? listActorsForGame(ctx, game._id)
      : Promise.resolve({
          actorById: new Map<string, Doc<"sim_game_actors">>(),
          actorByLegacyEmpireId: new Map<string, Doc<"sim_game_actors">>(),
        }),
    Promise.all(
      Array.from(empireIds).map(async (empireId) => {
        const empire = await ctx.db.get("emp_states", empireId as Id<"emp_states">);
        return [empireId, empire] as const;
      }),
    ),
    Promise.all(
      Array.from(systemIds).map(async (systemId) => {
        const system = await ctx.db.get("gal_systems", systemId as Id<"gal_systems">);
        return [systemId, system] as const;
      }),
    ),
  ]);

  const empireById = new Map(empires.filter(([, empire]) => empire !== null));
  const systemById = new Map(systems.filter(([, system]) => system !== null));

  const resolveActorAwareEmpireLabel = (
    actorId: string | null,
    empireId: string | null,
  ): string | null => {
    if (runtimeVersion === "v2_game_actor" && actorId !== null) {
      const actor = actors.actorById.get(actorId) ?? null;
      if (actor !== null) {
        return formatGameActorHistoryLabel(actor);
      }
    }
    if (empireId !== null) {
      const actor = actors.actorByLegacyEmpireId.get(empireId) ?? null;
      if (actor !== null) {
        return formatGameActorHistoryLabel(actor);
      }
      return empireById.get(empireId)?.name ?? null;
    }
    return null;
  };

  const resolveEntityLabel = (entityType: string | null, entityId: string | null): string | null => {
    if (entityType === null || entityId === null) {
      return null;
    }
    switch (entityType) {
      case "empire": {
        const actor = actors.actorById.get(entityId) ?? actors.actorByLegacyEmpireId.get(entityId) ?? null;
        if (actor !== null) {
          return formatGameActorHistoryLabel(actor);
        }
        return empireById.get(entityId)?.name ?? null;
      }
      case "game_actor": {
        const actor = actors.actorById.get(entityId) ?? null;
        return actor !== null ? formatGameActorHistoryLabel(actor) : null;
      }
      case "system":
        return systemById.get(entityId)?.name ?? null;
      case "sim":
        return game.name;
      default:
        return null;
    }
  };

  return events.map((event) => ({
    ...event,
    actorLabel: (() => {
      const payload = parseEventPayload(event.payload);
      if (
        event.eventType === "battle_started" ||
        event.eventType === "battle_round_resolved" ||
        event.eventType === "battle_continues" ||
        event.eventType === "battle_defender_changed"
      ) {
        return resolveActorAwareEmpireLabel(
          stringField(payload, "attackerGameActorId"),
          stringField(payload, "attackerEmpireId") ?? event.actorId,
        );
      }
      return resolveEntityLabel(event.actorType, event.actorId);
    })(),
    targetLabel: (() => {
      const payload = parseEventPayload(event.payload);
      if (
        event.eventType === "battle_started" ||
        event.eventType === "battle_round_resolved" ||
        event.eventType === "battle_continues" ||
        event.eventType === "battle_defender_changed"
      ) {
        return resolveActorAwareEmpireLabel(
          stringField(payload, "defenderGameActorId"),
          stringField(payload, "defenderEmpireId"),
        );
      }
      return resolveEntityLabel(event.targetType, event.targetId);
    })(),
  }));
}

export const listGames = query({
  args: { limit: v.number() },
  handler: async (ctx, args) => {
    const games = await ctx.db.query("sim_games").order("desc").take(args.limit);
    const resolvedGames = await Promise.all(games.map((game) => resolveLoadedGameMode(ctx, game)));
    return resolvedGames
      .filter((game): game is NonNullable<typeof game> => game !== null)
      .map((game) => ({
        ...game,
        runtimeVersion: resolveGameRuntimeVersion(game.runtimeVersion),
      }));
  },
});

export const getGame = query({
  args: { gameId: v.id("sim_games") },
  handler: async (ctx, args) => {
    const game = await loadGameWithResolvedMode(ctx, args.gameId);
    if (game === null) {
      return null;
    }
    return {
      ...game,
      runtimeVersion: resolveGameRuntimeVersion(game.runtimeVersion),
    };
  },
});

export const resolveGameRoute = query({
  args: { routeKey: v.string() },
  handler: async (ctx, args) => {
    const routeKey = args.routeKey.trim();
    if (routeKey.length === 0) {
      return null;
    }

    const byUrlCode = await ctx.db
      .query("sim_games")
      .withIndex("by_urlCode", (q) => q.eq("urlCode", routeKey))
      .unique();
    if (byUrlCode !== null) {
      return {
        gameId: byUrlCode._id,
        urlCode: byUrlCode.urlCode ?? null,
        name: byUrlCode.name,
        status: byUrlCode.status,
        finalizationState: byUrlCode.finalizationState ?? null,
        endedAt: byUrlCode.endedAt,
      };
    }

    const normalizedId = ctx.db.normalizeId("sim_games", routeKey);
    if (normalizedId === null) {
      return null;
    }

    const game = await loadGameWithResolvedMode(ctx, normalizedId);
    if (game === null) {
      return null;
    }

    return {
      gameId: game._id,
      urlCode: game.urlCode ?? null,
      name: game.name,
      status: game.status,
      finalizationState: game.finalizationState ?? null,
      endedAt: game.endedAt,
    };
  },
});

export const getDurableGameResult = query({
  args: { gameId: v.id("sim_games") },
  handler: async (ctx, args) => {
    const gameResult = await ctx.db
      .query("sim_game_results")
      .withIndex("by_gameId", (q) => q.eq("gameId", args.gameId))
      .unique();
    if (gameResult === null) {
      return null;
    }

    const empireResults = await ctx.db
      .query("emp_results")
      .withIndex("by_gameResultId", (q) => q.eq("gameResultId", gameResult._id))
      .collect();
    empireResults.sort((a, b) => a.placement - b.placement);

    return {
      gameResult,
      placements: empireResults.map((row) => {
        return {
          empireKey: row.empireKey,
          empireName: row.empireName,
          placement: row.placement,
          isWinner: row.isWinner,
          controllerKind: row.controllerKind,
          playerName: row.playerName,
          npcPlayerKey: row.npcPlayerKey,
          controllerLabel: buildResultControllerLabel({
            controllerKind: row.controllerKind,
            playerName: row.playerName,
            npcPlayerKey: row.npcPlayerKey,
          }),
          actorId: row.actorId ?? null,
          actorSlotNumber: row.actorSlotNumber ?? null,
          actorLabel: row.actorLabel ?? null,
          actorDisplayName: row.actorDisplayName ?? null,
          userId: row.userId,
          scoreFinal: row.scoreFinal,
          starsControlledFinal: row.starsControlledFinal,
          fleetStrengthFinal: row.fleetStrengthFinal,
          eliminated: row.eliminated,
          eliminationReason: row.eliminationReason,
          strategySummaryJson: row.strategySummaryJson,
        };
      }),
    };
  },
});

/**
 * Running games with current-turn resolution status for the /games dashboard.
 * Uses only stored timestamps; the client compares `resolvingStartedAt` to `Date.now()`
 * for “stuck resolving” hints (never uses Date.now() here — keeps queries reactive).
 */
export const listRunningGamesTurnProgress = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    const games = await ctx.db
      .query("sim_games")
      .withIndex("by_status", (q) => q.eq("status", "running"))
      .collect();
    const resolvedGames = await Promise.all(games.map((game) => resolveLoadedGameMode(ctx, game)));

    const result: {
      gameId: Id<"sim_games">;
      urlCode: string | null;
      name: string;
      mapKey: string;
      mode: "conquest_core" | "conquest_plus" | "trader_economy";
      runtimeVersion: "v1_empire" | "v2_game_actor";
      currentTurn: number;
      gameStartedAt: number | null;
      turnPausedUntilMs: number | undefined;
      simCronTurnsDisabled: boolean | undefined;
      nextPreparationWakeAt: number | null;
      nextBoundaryWakeAt: number | null;
      schedulerGeneration: number | null;
      lastWakeScheduledAt: number | null;
      lastWakeObservedAt: number | null;
      turnState: "open" | "resolving" | "preparing" | "prepared" | "resolved" | null;
      preparationState: "queued" | "preparing" | "prepared" | "committed" | "stale" | null;
      resolutionPhase: string | null;
      turnWorkLabel: string | null;
      resolvingStartedAt: number | null;
      viewerCanForceRetry: boolean;
    }[] = [];

    for (const game of resolvedGames) {
      if (game === null) {
        continue;
      }
      let viewerCanForceRetry = false;
      if (userId !== null) {
        const binding = await ctx.db
          .query("usr_game_roles")
          .withIndex("by_gameId_and_userId", (q) =>
            q.eq("gameId", game._id).eq("userId", userId),
          )
          .unique();
        viewerCanForceRetry =
          binding !== null && binding.isActive && binding.role === "admin";
      }

      const turnRow = await ctx.db
        .query("sim_turns")
        .withIndex("by_gameId_and_turnNumber", (q) =>
          q.eq("gameId", game._id).eq("turnNumber", game.currentTurn),
        )
        .unique();
      const preparationRow = await ctx.db
        .query("sim_turn_preparations")
        .withIndex("by_gameId_and_turnNumber", (q) =>
          q.eq("gameId", game._id).eq("turnNumber", game.currentTurn),
        )
        .unique();

      result.push({
        gameId: game._id,
        urlCode: game.urlCode ?? null,
        name: game.name,
        mapKey: game.mapKey,
        mode: resolveGameMode(game.mode),
        runtimeVersion: resolveGameRuntimeVersion(game.runtimeVersion),
        currentTurn: game.currentTurn,
        gameStartedAt: game.startedAt,
        turnPausedUntilMs: game.turnPausedUntilMs,
        simCronTurnsDisabled: game.simCronTurnsDisabled,
        nextPreparationWakeAt: game.nextPreparationWakeAt ?? null,
        nextBoundaryWakeAt: game.nextBoundaryWakeAt ?? null,
        schedulerGeneration: game.schedulerGeneration ?? null,
        lastWakeScheduledAt: game.lastWakeScheduledAt ?? null,
        lastWakeObservedAt: game.lastWakeObservedAt ?? null,
        turnState: turnRow?.state ?? null,
        preparationState: preparationRow?.state ?? null,
        resolutionPhase: turnRow?.resolutionPhase ?? null,
        turnWorkLabel: buildTurnWorkLabel({
          turnState: turnRow?.state,
          resolutionPhase: turnRow?.resolutionPhase,
        }),
        resolvingStartedAt: turnRow?.resolvingStartedAt ?? null,
        viewerCanForceRetry,
      });
    }

    result.sort((a, b) => b.gameId.localeCompare(a.gameId));
    return result;
  },
});

/** Used by the galaxy map to sync turn progress with en-route fleet animation. */
export const getTurnTimelineForGame = query({
  args: { gameId: v.id("sim_games") },
  handler: async (ctx, args) => {
    const game = await loadGameWithResolvedMode(ctx, args.gameId);
    if (game === null) {
      return null;
    }
    const turnRow = await ctx.db
      .query("sim_turns")
      .withIndex("by_gameId_and_turnNumber", (q) =>
        q.eq("gameId", args.gameId).eq("turnNumber", game.currentTurn),
      )
      .unique();
    const preparationRow = await ctx.db
      .query("sim_turn_preparations")
      .withIndex("by_gameId_and_turnNumber", (q) =>
        q.eq("gameId", args.gameId).eq("turnNumber", game.currentTurn),
      )
      .unique();
    return buildTurnTimelineSnapshot({ game, turnRow, preparationRow });
  },
});

/**
 * Bounded live package for turn-boundary presentation.
 *
 * This keeps the current-turn timing metadata and the event subsets needed by
 * the map/audio clients inside one reactive snapshot so the client can swap to
 * a committed turn with less cross-query skew.
 */
export const getTurnPresentationPackageForGame = query({
  args: { gameId: v.id("sim_games") },
  handler: async (ctx, args) => {
    const game = await loadGameWithResolvedMode(ctx, args.gameId);
    if (game === null) {
      return null;
    }

    const turnRow = await ctx.db
      .query("sim_turns")
      .withIndex("by_gameId_and_turnNumber", (q) =>
        q.eq("gameId", args.gameId).eq("turnNumber", game.currentTurn),
      )
      .unique();
    const preparationRow = await ctx.db
      .query("sim_turn_preparations")
      .withIndex("by_gameId_and_turnNumber", (q) =>
        q.eq("gameId", args.gameId).eq("turnNumber", game.currentTurn),
      )
      .unique();
    const previousTurnEvents =
      game.currentTurn > 0
        ? await ctx.db
            .query("sim_events")
            .withIndex("by_gameId_and_turnNumber", (q) =>
              q.eq("gameId", args.gameId).eq("turnNumber", game.currentTurn - 1),
            )
            .order("desc")
            .take(256)
        : [];
    const recentEvents = await ctx.db
      .query("sim_events")
      .withIndex("by_gameId", (q) => q.eq("gameId", args.gameId))
      .order("desc")
      .take(24);
    const visiblePreviousTurnEvents = filterEventsForGame(game, previousTurnEvents);
    const visibleRecentEvents = filterEventsForGame(game, recentEvents);
    const [presentedPreviousTurnEvents, presentedRecentEvents] = await Promise.all([
      attachEventPresentationMetadata(ctx, game, visiblePreviousTurnEvents),
      attachEventPresentationMetadata(ctx, game, visibleRecentEvents),
    ]);

    return {
      timeline: buildTurnTimelineSnapshot({ game, turnRow, preparationRow }),
      presentation: {
        previousTurnCombatEvents: filterCombatReplayEvents(presentedPreviousTurnEvents),
        recentSoundscapeEvents: filterSoundscapeEvents(presentedRecentEvents),
      },
    };
  },
});

export const listRecentEvents = query({
  args: { gameId: v.id("sim_games"), limit: v.number() },
  handler: async (ctx, args) => {
    const game = await loadGameWithResolvedMode(ctx, args.gameId);
    if (game === null) {
      return [];
    }

    const events = await ctx.db
      .query("sim_events")
      .withIndex("by_gameId", (q) => q.eq("gameId", args.gameId))
      .order("desc")
      .take(args.limit);

    return await attachEventPresentationMetadata(ctx, game, filterEventsForGame(game, events));
  },
});

export const listEventsByTurn = query({
  args: {
    gameId: v.id("sim_games"),
    turnNumber: v.number(),
    limit: v.number(),
  },
  handler: async (ctx, args) => {
    const game = await loadGameWithResolvedMode(ctx, args.gameId);
    if (game === null) {
      return [];
    }

    const events = await ctx.db
      .query("sim_events")
      .withIndex("by_gameId_and_turnNumber", (q) =>
        q.eq("gameId", args.gameId).eq("turnNumber", args.turnNumber),
      )
      .order("desc")
      .take(args.limit);

    return await attachEventPresentationMetadata(ctx, game, filterEventsForGame(game, events));
  },
});

/**
 * Cursor-paginated event history for the /history screen.
 *
 * When `eventType` is provided the `by_gameId_and_eventType` index is used
 * so the DB does not scan unrelated rows.  With no filter the full game
 * log is paged newest-first via `by_gameId`.
 */
export const listEventsPaginated = query({
  args: {
    gameId: v.id("sim_games"),
    paginationOpts: paginationOptsValidator,
    /** Exact event type string to filter on, e.g. "battle_started". Omit for all. */
    eventType: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const game = await loadGameWithResolvedMode(ctx, args.gameId);
    if (game === null) {
      return {
        page: [],
        isDone: true,
        continueCursor: args.paginationOpts.cursor ?? "",
      };
    }

    if (args.eventType !== undefined) {
      const result = await ctx.db
        .query("sim_events")
        .withIndex("by_gameId_and_eventType", (q) =>
          q.eq("gameId", args.gameId).eq("eventType", args.eventType as string),
        )
        .order("desc")
        .paginate(args.paginationOpts);

      const filteredPage = filterEventsForGame(game, result.page);
      return {
        ...result,
        page: await attachEventPresentationMetadata(ctx, game, filteredPage),
      };
    }
    const result = await ctx.db
      .query("sim_events")
      .withIndex("by_gameId", (q) => q.eq("gameId", args.gameId))
      .order("desc")
      .paginate(args.paginationOpts);

    const filteredPage = filterEventsForGame(game, result.page);
    return {
      ...result,
      page: await attachEventPresentationMetadata(ctx, game, filteredPage),
    };
  },
});
