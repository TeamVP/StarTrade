export const DEFAULT_TURN_DURATION_SECONDS = 10;
export const DEFAULT_TURN_DURATION_MS = DEFAULT_TURN_DURATION_SECONDS * 1000;
export const TURN_RESOLUTION_POLL_INTERVAL_SECONDS = 1;

function clampPauseDurationMs(pausedAtMs: number, resumedAtMs: number): number {
  return Math.max(0, resumedAtMs - pausedAtMs);
}

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

export function resumedTurnStartedAt(params: {
  turnStartedAtMs: number;
  pausedAtMs: number;
  resumedAtMs: number;
}): number {
  return params.turnStartedAtMs + clampPauseDurationMs(params.pausedAtMs, params.resumedAtMs);
}

export function shiftPausedDeadline(params: {
  deadlineMs: number;
  pausedAtMs: number;
  resumedAtMs: number;
}): number {
  return params.deadlineMs + clampPauseDurationMs(params.pausedAtMs, params.resumedAtMs);
}

export function msUntilTurnBoundary(params: {
  nowMs: number;
  turnStartedAtMs: number;
  turnDurationMs: number;
}) {
  return Math.max(
    0,
    scheduledNextTurnStartedAt({
      turnStartedAtMs: params.turnStartedAtMs,
      turnDurationMs: params.turnDurationMs,
    }) - params.nowMs,
  );
}
