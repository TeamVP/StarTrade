import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import {
  canonicalizeStrategyJson,
  summarizeAutomationStrategy,
} from "../usr/automationStrategyLibrary";

export const GAME_ABANDONMENT_INACTIVITY_MS = 7 * 24 * 60 * 60 * 1000;

type FinishReason =
  | "last_empire_standing"
  | "abandoned_scored"
  | "admin_terminated_discarded"
  | "admin_terminated_scored";

type RetentionClass = "discarded" | "official" | "archived_debug";

type EmpireStanding = {
  empire: Doc<"emp_states">;
  controllerKind: "human" | "npc";
  userId: Id<"users"> | null;
  npcPlayerKey: string | null;
  playerName: string | null;
  starsControlled: number;
  populationFinal: number;
  fleetCountFinal: number;
  fleetStrengthFinal: number;
  treasuryFinal: number;
  researchPoolFinal: number;
  homeSystemSurvived: boolean;
  strategyJson: string | null;
  strategySummaryJson: string | null;
  strategyFingerprint: string | null;
  strategyLibraryKey: string | null;
  strategySourceKind: "manual" | "library" | "custom" | "npc_default" | null;
  isAlive: boolean;
};

export function nextGameAbandonmentEligibleAt(activityAt: number): number {
  return activityAt + GAME_ABANDONMENT_INACTIVITY_MS;
}

export async function touchGameMeaningfulActivity(
  ctx: MutationCtx,
  gameId: Id<"sim_games">,
  options?: { humanAction?: boolean; now?: number },
): Promise<void> {
  const game = await ctx.db.get(gameId);
  if (game === null) return;
  const now = options?.now ?? Date.now();
  await ctx.db.patch("sim_games", gameId, {
    lastMeaningfulActivityAt: now,
    lastHumanActionAt: options?.humanAction ? now : game.lastHumanActionAt,
    abandonmentEligibleAt: nextGameAbandonmentEligibleAt(now),
  });
}

export async function recordGameTurnResolved(
  ctx: MutationCtx,
  gameId: Id<"sim_games">,
  resolvedAt: number,
): Promise<void> {
  const game = await ctx.db.get(gameId);
  if (game === null) return;
  await ctx.db.patch("sim_games", gameId, {
    lastMeaningfulActivityAt: resolvedAt,
    lastResolvedTurnAt: resolvedAt,
    abandonmentEligibleAt: nextGameAbandonmentEligibleAt(resolvedAt),
  });
}

function strategyFingerprint(strategyJson: string): string {
  let hash = 2166136261;
  for (let index = 0; index < strategyJson.length; index += 1) {
    hash ^= strategyJson.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function rankEmpireStandings(a: EmpireStanding, b: EmpireStanding): number {
  if (a.starsControlled !== b.starsControlled) return b.starsControlled - a.starsControlled;
  if (a.fleetStrengthFinal !== b.fleetStrengthFinal) {
    return b.fleetStrengthFinal - a.fleetStrengthFinal;
  }
  if (a.populationFinal !== b.populationFinal) return b.populationFinal - a.populationFinal;
  if (a.treasuryFinal !== b.treasuryFinal) return b.treasuryFinal - a.treasuryFinal;
  return a.empire.empireKey.localeCompare(b.empire.empireKey);
}

async function loadEmpireStandings(
  ctx: MutationCtx,
  gameId: Id<"sim_games">,
): Promise<EmpireStanding[]> {
  const [empires, systems, fleets, roles] = await Promise.all([
    ctx.db.query("emp_states").withIndex("by_gameId", (q) => q.eq("gameId", gameId)).collect(),
    ctx.db.query("gal_systems").withIndex("by_gameId", (q) => q.eq("gameId", gameId)).take(512),
    ctx.db.query("flt_fleets").withIndex("by_gameId", (q) => q.eq("gameId", gameId)).take(512),
    ctx.db
      .query("usr_game_roles")
      .withIndex("by_gameId_and_role", (q) => q.eq("gameId", gameId).eq("role", "empire"))
      .collect(),
  ]);

  const starsByEmpire = new Map<string, number>();
  const systemById = new Map<string, Doc<"gal_systems">>();
  for (const system of systems) {
    systemById.set(system._id, system);
    if (system.ownerEmpireId !== null) {
      starsByEmpire.set(system.ownerEmpireId, (starsByEmpire.get(system.ownerEmpireId) ?? 0) + 1);
    }
  }

  const fleetsByEmpire = new Map<string, { count: number; strength: number }>();
  for (const fleet of fleets) {
    const prev = fleetsByEmpire.get(fleet.empireId) ?? { count: 0, strength: 0 };
    fleetsByEmpire.set(fleet.empireId, {
      count: prev.count + 1,
      strength: prev.strength + fleet.strength,
    });
  }

  const humanUserByEmpire = new Map<string, Id<"users">>();
  for (const role of roles) {
    if (role.isActive && role.empireId !== null) {
      humanUserByEmpire.set(role.empireId, role.userId);
    }
  }

  return empires.map((empire) => {
    const starsControlled = starsByEmpire.get(empire._id) ?? 0;
    const fleetStats = fleetsByEmpire.get(empire._id) ?? { count: 0, strength: 0 };
    const userId = humanUserByEmpire.get(empire._id) ?? null;
    const controllerKind = empire.controller === "human" || userId !== null ? "human" : "npc";
    const normalizedStrategy =
      empire.strategyJson !== undefined ? canonicalizeStrategyJson(empire.strategyJson) : null;

    return {
      empire,
      controllerKind,
      userId,
      npcPlayerKey: empire.npcPlayerKey ?? null,
      playerName: empire.playerName ?? null,
      starsControlled,
      populationFinal: empire.population,
      fleetCountFinal: fleetStats.count,
      fleetStrengthFinal: fleetStats.strength,
      treasuryFinal: empire.treasury,
      researchPoolFinal: empire.researchPool ?? 0,
      homeSystemSurvived:
        empire.homeSystemId !== null &&
        systemById.get(empire.homeSystemId)?.ownerEmpireId === empire._id,
      strategyJson: normalizedStrategy,
      strategySummaryJson:
        normalizedStrategy === null
          ? null
          : JSON.stringify(summarizeAutomationStrategy(normalizedStrategy)),
      strategyFingerprint:
        normalizedStrategy === null ? null : strategyFingerprint(normalizedStrategy),
      strategyLibraryKey: null,
      strategySourceKind:
        normalizedStrategy === null
          ? null
          : controllerKind === "npc"
            ? "npc_default"
            : "custom",
      isAlive: starsControlled > 0 || fleetStats.strength > 0,
    } satisfies EmpireStanding;
  });
}

async function upsertResultsForGame(
  ctx: MutationCtx,
  game: Doc<"sim_games">,
  standings: EmpireStanding[],
  finishReason: FinishReason,
  retentionClass: RetentionClass,
): Promise<void> {
  const ordered = [...standings].sort(rankEmpireStandings);
  const winner = ordered[0] ?? null;
  const endedAt = game.endedAt ?? Date.now();
  const existing = await ctx.db
    .query("sim_game_results")
    .withIndex("by_gameId", (q) => q.eq("gameId", game._id))
    .unique();

  const baseResult = {
    gameId: game._id,
    name: game.name,
    mapKey: game.mapKey,
    lobbyScenarioKey: game.lobbyScenarioKey,
    seed: game.seed,
    startedAt: game.startedAt,
    endedAt,
    lastResolvedTurnNumber: game.currentTurn,
    retentionClass,
    isOfficial: retentionClass === "official",
    finishReason,
    winnerEmpireKey: winner?.empire.empireKey ?? null,
    winnerEmpireResultId: existing?.winnerEmpireResultId ?? null,
    winnerControllerKind: winner?.controllerKind ?? null,
    winnerUserId: winner?.userId ?? null,
    winnerNpcPlayerKey: winner?.npcPlayerKey ?? null,
    winningStarsControlled: winner?.starsControlled,
    winningFleetStrength: winner?.fleetStrengthFinal,
    empireCount: ordered.length,
    humanEmpireCount: ordered.filter((row) => row.controllerKind === "human").length,
    npcEmpireCount: ordered.filter((row) => row.controllerKind === "npc").length,
    summaryJson: JSON.stringify({
      topEmpires: ordered.slice(0, 3).map((row) => ({
        empireKey: row.empire.empireKey,
        empireName: row.empire.name,
        controllerKind: row.controllerKind,
        starsControlled: row.starsControlled,
        fleetStrength: row.fleetStrengthFinal,
      })),
    }),
  };

  const gameResultId =
    existing === null
      ? await ctx.db.insert("sim_game_results", baseResult)
      : (await ctx.db.patch("sim_game_results", existing._id, baseResult), existing._id);

  const existingEmpResults = await ctx.db
    .query("emp_results")
    .withIndex("by_gameResultId", (q) => q.eq("gameResultId", gameResultId))
    .collect();
  const existingByEmpireKey = new Map(existingEmpResults.map((row) => [row.empireKey, row]));

  let winnerEmpireResultId: Id<"emp_results"> | null = null;
  for (const [index, row] of ordered.entries()) {
    const existingEmpResult = existingByEmpireKey.get(row.empire.empireKey) ?? null;
    const isWinner = index === 0;
    const eliminated = !row.isAlive;
    const eliminationReason: "destroyed" | "collapsed" | "abandoned" | "survived_to_score" | null =
      eliminated
        ? (row.empire.isCollapsed ? "collapsed" : "destroyed")
        : finishReason === "last_empire_standing"
          ? null
          : "survived_to_score";
    const empResult = {
      gameResultId,
      gameId: game._id,
      empireId: row.empire._id,
      empireKey: row.empire.empireKey,
      empireName: row.empire.name,
      colorHex: row.empire.colorHex,
      controllerKind: row.controllerKind,
      userId: row.userId,
      npcPlayerKey: row.npcPlayerKey,
      playerName: row.playerName,
      strategyJson: row.strategyJson,
      strategySummaryJson: row.strategySummaryJson,
      strategyFingerprint: row.strategyFingerprint,
      strategyLibraryKey: row.strategyLibraryKey,
      strategySourceKind: row.strategySourceKind,
      placement: index + 1,
      isWinner,
      eliminated,
      eliminatedAtTurn: eliminated ? game.currentTurn : null,
      eliminationReason,
      starsControlledFinal: row.starsControlled,
      populationFinal: row.populationFinal,
      fleetCountFinal: row.fleetCountFinal,
      fleetStrengthFinal: row.fleetStrengthFinal,
      treasuryFinal: row.treasuryFinal,
      researchPoolFinal: row.researchPoolFinal,
      homeSystemSurvived: row.homeSystemSurvived,
      scoreFinal: row.starsControlled,
      scoreBreakdownJson: JSON.stringify({
        starsControlled: row.starsControlled,
        fleetStrength: row.fleetStrengthFinal,
        population: row.populationFinal,
        treasury: row.treasuryFinal,
      }),
    };

    const empResultId =
      existingEmpResult === null
        ? await ctx.db.insert("emp_results", empResult)
        : (await ctx.db.patch("emp_results", existingEmpResult._id, empResult),
          existingEmpResult._id);
    if (isWinner) winnerEmpireResultId = empResultId;
  }

  await ctx.db.patch("sim_game_results", gameResultId, { winnerEmpireResultId });
}

export async function queueFinishedGameCleanup(
  ctx: MutationCtx,
  gameId: Id<"sim_games">,
): Promise<void> {
  const game = await ctx.db.get(gameId);
  if (game === null || game.cleanupQueuedAt !== undefined) return;

  const now = Date.now();
  await ctx.db.patch("sim_games", gameId, {
    cleanupQueuedAt: now,
    finalizationState: "pending_cleanup",
  });
  await ctx.scheduler.runAfter(0, internal.admin.internal.continueWipeGame, {
    gameId,
    phaseIndex: 0,
  });
}

export async function evaluateGameFinalization(
  ctx: MutationCtx,
  params: {
    gameId: Id<"sim_games">;
    forceFinishReason?: "abandoned_scored" | "admin_terminated_scored";
  },
): Promise<{ finalized: boolean; finishReason: FinishReason | null }> {
  const game = await ctx.db.get(params.gameId);
  if (game === null) return { finalized: false, finishReason: null };
  if (game.finalizationState === "pending_cleanup" || game.finalizationState === "cleaned") {
    return { finalized: false, finishReason: game.finishReason ?? null };
  }

  const activityBase = Math.max(
    game.lastMeaningfulActivityAt ?? 0,
    game.lastResolvedTurnAt ?? 0,
    game.lastHumanActionAt ?? 0,
    game.startedAt ?? game._creationTime,
  );
  const abandonmentEligibleAt = nextGameAbandonmentEligibleAt(activityBase);
  if (game.abandonmentEligibleAt !== abandonmentEligibleAt) {
    await ctx.db.patch("sim_games", game._id, { abandonmentEligibleAt });
  }

  const standings = await loadEmpireStandings(ctx, game._id);
  const alive = standings.filter((row) => row.isAlive);

  let finishReason: FinishReason | null = params.forceFinishReason ?? null;
  if (finishReason === null) {
    if (alive.length <= 1 && standings.length > 0) {
      finishReason = "last_empire_standing";
    } else if (game.status === "finished") {
      finishReason = game.finishReason ?? null;
    } else if (
      (game.status === "running" || game.status === "paused") &&
      alive.length > 1 &&
      Date.now() >= abandonmentEligibleAt
    ) {
      finishReason = "abandoned_scored";
    }
  }

  if (finishReason === null) {
    return { finalized: false, finishReason: null };
  }

  const winner = [...standings].sort(rankEmpireStandings)[0] ?? null;
  const retentionClass: RetentionClass =
    game.retentionClass ?? (finishReason === "admin_terminated_discarded" ? "discarded" : "official");
  const now = Date.now();

  await ctx.db.patch("sim_games", game._id, {
    status: "finished",
    endedAt: game.endedAt ?? now,
    retentionClass,
    finishReason,
    winnerEmpireKey: winner?.empire.empireKey ?? game.winnerEmpireKey ?? null,
    abandonedAt: finishReason === "abandoned_scored" ? (game.abandonedAt ?? now) : game.abandonedAt,
    finalizationState:
      retentionClass === "discarded"
        ? "pending_cleanup"
        : retentionClass === "archived_debug"
          ? "archived_debug"
          : "pending_result_write",
  });

  if (retentionClass === "discarded") {
    await queueFinishedGameCleanup(ctx, game._id);
    return { finalized: true, finishReason };
  }

  const refreshedGame = await ctx.db.get(game._id);
  if (refreshedGame === null) {
    return { finalized: false, finishReason: null };
  }
  await upsertResultsForGame(ctx, refreshedGame, standings, finishReason, retentionClass);

  await ctx.db.patch("sim_games", game._id, {
    finalizationState: retentionClass === "archived_debug" ? "archived_debug" : "results_written",
  });
  if (retentionClass === "official") {
    await queueFinishedGameCleanup(ctx, game._id);
  }

  return { finalized: true, finishReason };
}