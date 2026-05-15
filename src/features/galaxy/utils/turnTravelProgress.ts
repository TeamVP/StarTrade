function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function clampNonNegative(value: number): number {
  return Math.max(0, value);
}

function finitePositiveTurnCount(value: number): number {
  return Number.isFinite(value) ? Math.max(1, Math.floor(value)) : 1;
}

function travelTurnsFromParams(params: {
  dispatchedTurn: number;
  etaTurn: number;
  travelTurnsTotal: number;
}): number {
  return finitePositiveTurnCount(
    params.etaTurn > params.dispatchedTurn
      ? params.etaTurn - params.dispatchedTurn
      : params.travelTurnsTotal,
  );
}

/**
 * Fraction 0-1 along an in-flight ship's current leg.
 *
 * Ships dispatched while turn T is resolving start moving during open turn T+1.
 * At each turn boundary, the end fraction of the previous turn equals the start
 * fraction of the next turn, so fleets, colony ships, and trader ships do not
 * snap back when the Convex timeline advances.
 */
export function turnTravelProgress(params: {
  now: number;
  currentTurn: number;
  dispatchedTurn: number;
  etaTurn: number;
  travelTurnsTotal: number;
  turnStartedAt: number | null;
  turnDurationMs: number;
}): number {
  const travelTurns = travelTurnsFromParams(params);

  if (params.currentTurn < params.dispatchedTurn) {
    return 0;
  }
  if (params.currentTurn > params.dispatchedTurn + travelTurns) {
    return 1;
  }

  const phase =
    params.turnStartedAt === null
      ? 0
      : clampNonNegative(
          (params.now - params.turnStartedAt) / Math.max(1, params.turnDurationMs),
        );
  if (params.currentTurn === params.dispatchedTurn) {
    return clamp01((phase - 1) / travelTurns);
  }

  const completedTurnsAtTurnStart = Math.min(
    Math.max(params.currentTurn - params.dispatchedTurn - 1, 0),
    travelTurns - 1,
  );

  return clamp01((completedTurnsAtTurnStart + phase) / travelTurns);
}

export function turnTravelArrivalAlpha(params: {
  progress: number;
  dispatchedTurn: number;
  etaTurn: number;
  travelTurnsTotal: number;
  turnDurationMs: number;
  fadeMs?: number;
}): number {
  const fadeMs = Math.max(1, params.fadeMs ?? 300);
  const travelTurns = travelTurnsFromParams(params);
  const remainingMs =
    (1 - clamp01(params.progress)) * travelTurns * Math.max(1, params.turnDurationMs);
  return clamp01(remainingMs / fadeMs);
}
