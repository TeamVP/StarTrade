export const DEFAULT_TURN_DURATION_SECONDS = 10;
export const DEFAULT_TURN_DURATION_MS = DEFAULT_TURN_DURATION_SECONDS * 1000;

export function turnDurationHasElapsed(params: {
  nowMs: number;
  turnStartedAtMs: number;
  turnDurationMs: number;
}): boolean {
  return params.nowMs >= params.turnStartedAtMs + Math.max(1, params.turnDurationMs);
}

export function scheduledNextTurnStartedAt(params: {
  turnStartedAtMs: number;
  turnDurationMs: number;
}): number {
  return params.turnStartedAtMs + Math.max(1, params.turnDurationMs);
}
