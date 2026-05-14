function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function finitePositiveTurnCount(value: number): number {
  return Number.isFinite(value) ? Math.max(1, Math.floor(value)) : 1;
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
  const travelTurns = finitePositiveTurnCount(
    params.etaTurn > params.dispatchedTurn
      ? params.etaTurn - params.dispatchedTurn
      : params.travelTurnsTotal,
  );

  if (params.currentTurn <= params.dispatchedTurn) {
    return 0;
  }
  if (params.currentTurn > params.dispatchedTurn + travelTurns) {
    return 1;
  }

  const phase =
    params.turnStartedAt === null
      ? 0
      : clamp01((params.now - params.turnStartedAt) / Math.max(1, params.turnDurationMs));
  const completedTurnsAtTurnStart = Math.min(
    Math.max(params.currentTurn - params.dispatchedTurn - 1, 0),
    travelTurns - 1,
  );

  return clamp01((completedTurnsAtTurnStart + phase) / travelTurns);
}
