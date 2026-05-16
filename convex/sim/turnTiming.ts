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

export function turnPreparationLeadMs(turnDurationMs: number): number {
  const safeDurationMs = Math.max(1, turnDurationMs);
  return Math.min(4_000, Math.max(1_000, Math.round(safeDurationMs * 0.2)));
}

export function scheduledTurnPreparationAt(params: {
  turnStartedAtMs: number;
  turnDurationMs: number;
}): number {
  const boundaryAtMs = scheduledNextTurnStartedAt(params);
  return Math.max(
    params.turnStartedAtMs,
    boundaryAtMs - turnPreparationLeadMs(params.turnDurationMs),
  );
}

export function committedNextTurnStartedAt(params: {
  turnStartedAtMs: number;
  turnDurationMs: number;
  preparedAtMs: number | undefined;
  committedAtMs: number;
}): number {
  const boundaryAtMs = scheduledNextTurnStartedAt({
    turnStartedAtMs: params.turnStartedAtMs,
    turnDurationMs: params.turnDurationMs,
  });
  return params.preparedAtMs !== undefined && params.preparedAtMs <= boundaryAtMs
    ? boundaryAtMs
    : params.committedAtMs;
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
}): number {
  return Math.max(
    0,
    scheduledNextTurnStartedAt({
      turnStartedAtMs: params.turnStartedAtMs,
      turnDurationMs: params.turnDurationMs,
    }) - params.nowMs,
  );
}

export function msUntilTurnPreparationStart(params: {
  nowMs: number;
  turnStartedAtMs: number;
  turnDurationMs: number;
}): number {
  return Math.max(
    0,
    scheduledTurnPreparationAt({
      turnStartedAtMs: params.turnStartedAtMs,
      turnDurationMs: params.turnDurationMs,
    }) - params.nowMs,
  );
}
