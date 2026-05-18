import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { getMissionByKey } from "../usr/missionCatalog";

export type GameMode = "conquest_core" | "conquest_plus" | "trader_economy";
export type ResolvedMissingGameModeSource = "mission" | "legacy_trader_runtime" | "fallback";
export const TURN_RESOLUTION_PHASES = [
  "movement",
  "economy",
  "npc",
  "trade",
  "traderSetup",
  "tradeSpawn",
  "garrisons",
  "finalize",
] as const;
export type TurnResolutionPhase = (typeof TURN_RESOLUTION_PHASES)[number];
export const FIRST_TURN_RESOLUTION_PHASE: TurnResolutionPhase = TURN_RESOLUTION_PHASES[0];
export type ResolutionPhaseKey =
  | "economy"
  | "npc"
  | "trade"
  | "traderSetup"
  | "tradeSpawn"
  | "garrisons";

export type GameModeConfig = {
  mode: GameMode;
  capabilities: {
    traderEconomy: boolean;
  };
  activeResolutionPhases: readonly ResolutionPhaseKey[];
};

const GAME_MODE_CONFIG: Record<GameMode, GameModeConfig> = {
  conquest_core: {
    mode: "conquest_core",
    capabilities: {
      traderEconomy: false,
    },
    activeResolutionPhases: ["economy", "npc", "garrisons"],
  },
  conquest_plus: {
    mode: "conquest_plus",
    capabilities: {
      traderEconomy: false,
    },
    activeResolutionPhases: ["economy", "npc", "garrisons"],
  },
  trader_economy: {
    mode: "trader_economy",
    capabilities: {
      traderEconomy: true,
    },
    activeResolutionPhases: [
      "economy",
      "npc",
      "trade",
      "traderSetup",
      "tradeSpawn",
      "garrisons",
    ],
  },
};

export function resolveGameMode(mode: GameMode | undefined | null): GameMode {
  return mode ?? "conquest_core";
}

type DbCtx = { db: QueryCtx["db"] | MutationCtx["db"] };

async function legacyGameShowsTraderRuntime(
  ctx: DbCtx,
  gameId: Id<"sim_games">,
): Promise<boolean> {
  const activeVoyages = await ctx.db
    .query("eco_bg_traders")
    .withIndex("by_gameId_and_status", (q) => q.eq("gameId", gameId).eq("status", "enRoute"))
    .take(1);
  return activeVoyages.length > 0;
}

export async function resolveMissingGameMode(
  ctx: DbCtx,
  game: Doc<"sim_games">,
): Promise<{ mode: GameMode; source: ResolvedMissingGameModeSource }> {
  const missionKey = game.missionKey ?? game.lobbyScenarioKey ?? undefined;
  if (missionKey !== undefined && missionKey !== null) {
    const mission = await getMissionByKey(ctx, missionKey);
    if (mission !== null) {
      return { mode: mission.mode, source: "mission" };
    }
  }

  if (await legacyGameShowsTraderRuntime(ctx, game._id)) {
    return { mode: "trader_economy", source: "legacy_trader_runtime" };
  }

  return { mode: "conquest_core", source: "fallback" };
}

export async function resolveLoadedGameMode(
  ctx: DbCtx,
  game: Doc<"sim_games"> | null,
): Promise<Doc<"sim_games"> | null> {
  if (game === null || game.mode !== undefined) {
    return game;
  }

  const resolved = await resolveMissingGameMode(ctx, game);
  return { ...game, mode: resolved.mode };
}

export async function persistLoadedGameMode(
  ctx: MutationCtx,
  game: Doc<"sim_games"> | null,
): Promise<Doc<"sim_games"> | null> {
  const resolved = await resolveLoadedGameMode(ctx, game);
  if (game === null || resolved === null || game.mode !== undefined || resolved.mode === undefined) {
    return resolved;
  }

  await ctx.db.patch("sim_games", game._id, { mode: resolved.mode });
  return resolved;
}

export async function loadGameWithResolvedMode(
  ctx: DbCtx,
  gameId: Id<"sim_games">,
): Promise<Doc<"sim_games"> | null> {
  return await resolveLoadedGameMode(ctx, await ctx.db.get("sim_games", gameId));
}

export async function loadGameWithPersistedResolvedMode(
  ctx: MutationCtx,
  gameId: Id<"sim_games">,
): Promise<Doc<"sim_games"> | null> {
  return await persistLoadedGameMode(ctx, await ctx.db.get("sim_games", gameId));
}

export function getGameModeConfig(game: Pick<Doc<"sim_games">, "mode"> | { mode?: GameMode | null | undefined }): GameModeConfig {
  return GAME_MODE_CONFIG[resolveGameMode(game.mode)];
}

export function gameUsesTraderEconomy(
  game: Pick<Doc<"sim_games">, "mode"> | { mode?: GameMode | null | undefined },
): boolean {
  return getGameModeConfig(game).capabilities.traderEconomy;
}

export function assertGameUsesTraderEconomy(
  game: Pick<Doc<"sim_games">, "mode"> | { mode?: GameMode | null | undefined },
  operation: string,
): void {
  const mode = resolveGameMode(game.mode);
  if (gameUsesTraderEconomy(game)) {
    return;
  }
  throw new Error(`${operation} requires trader_economy mode; got ${mode}.`);
}

export async function loadTraderEconomyGame(
  ctx: MutationCtx,
  gameId: Id<"sim_games">,
  operation: string,
): Promise<Doc<"sim_games">> {
  const game = await loadGameWithPersistedResolvedMode(ctx, gameId);
  if (game === null) {
    throw new Error(`${operation} requires an existing game.`);
  }
  assertGameUsesTraderEconomy(game, operation);
  return game;
}

export function liveEventHistoryTurnsToKeep(
  game:
    | Pick<Doc<"sim_games">, "mode" | "retentionClass">
    | {
        mode?: GameMode | null | undefined;
        retentionClass?: Doc<"sim_games">["retentionClass"] | null | undefined;
      },
): number | null {
  if (game.retentionClass === "archived_debug") {
    return null;
  }
  return gameUsesTraderEconomy(game) ? 24 : 12;
}

export function completedTraderVoyageHistoryTurnsToKeep(
  game:
    | Pick<Doc<"sim_games">, "mode" | "retentionClass">
    | {
        mode?: GameMode | null | undefined;
        retentionClass?: Doc<"sim_games">["retentionClass"] | null | undefined;
      },
): number | null {
  if (game.retentionClass === "archived_debug" || !gameUsesTraderEconomy(game)) {
    return null;
  }
  return 24;
}

export function economyTranscriptHistoryTurnsToKeep(
  game:
    | Pick<Doc<"sim_games">, "mode" | "retentionClass">
    | {
        mode?: GameMode | null | undefined;
        retentionClass?: Doc<"sim_games">["retentionClass"] | null | undefined;
      },
): number | null {
  if (game.retentionClass === "archived_debug" || !gameUsesTraderEconomy(game)) {
    return null;
  }
  return 1;
}

export function gameRunsResolutionPhase(
  game: Pick<Doc<"sim_games">, "mode"> | { mode?: GameMode | null | undefined },
  phase: ResolutionPhaseKey,
): boolean {
  return getGameModeConfig(game).activeResolutionPhases.includes(phase);
}

export function nextTurnResolutionPhase(
  game: Pick<Doc<"sim_games">, "mode"> | { mode?: GameMode | null | undefined },
  currentPhase: TurnResolutionPhase,
): TurnResolutionPhase {
  const sequence = buildTurnResolutionSequence(game);
  const currentIndex = sequence.indexOf(currentPhase);
  if (currentIndex === -1) {
    return "finalize";
  }
  return sequence[Math.min(currentIndex + 1, sequence.length - 1)] ?? "finalize";
}

export function parseTurnResolutionPhase(
  value: string | undefined,
): TurnResolutionPhase {
  return TURN_RESOLUTION_PHASES.includes(value as TurnResolutionPhase)
    ? (value as TurnResolutionPhase)
    : FIRST_TURN_RESOLUTION_PHASE;
}

export function compareTurnResolutionPhases(
  left: TurnResolutionPhase,
  right: TurnResolutionPhase,
): number {
  return TURN_RESOLUTION_PHASES.indexOf(left) - TURN_RESOLUTION_PHASES.indexOf(right);
}

export function resolutionPhasesBetween(
  game: Pick<Doc<"sim_games">, "mode"> | { mode?: GameMode | null | undefined },
  currentPhase: TurnResolutionPhase,
  nextExclusivePhase: TurnResolutionPhase,
): TurnResolutionPhase[] {
  const sequence = buildTurnResolutionSequence(game);
  const currentIndex = sequence.indexOf(currentPhase);
  const nextExclusiveIndex = sequence.indexOf(nextExclusivePhase);
  if (currentIndex === -1 || nextExclusiveIndex === -1 || currentIndex >= nextExclusiveIndex) {
    return [];
  }
  return sequence.slice(currentIndex + 1, nextExclusiveIndex);
}

function buildTurnResolutionSequence(
  game: Pick<Doc<"sim_games">, "mode"> | { mode?: GameMode | null | undefined },
): TurnResolutionPhase[] {
  return [
    FIRST_TURN_RESOLUTION_PHASE,
    ...getGameModeConfig(game).activeResolutionPhases,
    "finalize",
  ];
}
