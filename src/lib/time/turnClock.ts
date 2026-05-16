type TurnClockStatus = "lobby" | "running" | "paused" | "finished" | null | undefined;

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

export function estimateServerClockOffsetMs(params: {
  serverNowMs: number;
  clientReceivedAtMs: number;
}) {
  return params.serverNowMs - params.clientReceivedAtMs;
}

export function getServerAlignedNowMs(params: {
  clientNowMs: number;
  serverClockOffsetMs?: number | null;
}) {
  return params.clientNowMs + (params.serverClockOffsetMs ?? 0);
}

export function getTurnEffectiveNowMs(params: {
  nowMs: number;
  gameStatus: TurnClockStatus;
  turnPausedAtMs?: number | null;
}) {
  if (params.gameStatus === "paused" && params.turnPausedAtMs !== undefined && params.turnPausedAtMs !== null) {
    return params.turnPausedAtMs;
  }
  return params.nowMs;
}

export function getTurnTimeRemaining(
  turnStartedAtMs: number,
  turnDurationMs: number,
  nowMs: number,
) {
  const elapsed = Math.max(0, nowMs - turnStartedAtMs);
  return Math.max(0, turnDurationMs - elapsed);
}

export function getTurnElapsedFraction(params: {
  turnStartedAtMs: number | null;
  turnDurationMs: number | null;
  nowMs: number;
  gameStatus: TurnClockStatus;
  turnPausedAtMs?: number | null;
}) {
  if (params.turnStartedAtMs === null || params.turnDurationMs === null || params.turnDurationMs <= 0) {
    return null;
  }
  const effectiveNowMs = getTurnEffectiveNowMs({
    nowMs: params.nowMs,
    gameStatus: params.gameStatus,
    turnPausedAtMs: params.turnPausedAtMs,
  });
  return clamp01((effectiveNowMs - params.turnStartedAtMs) / params.turnDurationMs);
}

export function formatMsAsClock(ms: number) {
  const totalSeconds = Math.ceil(ms / 1000);
  const seconds = Math.max(0, totalSeconds);
  return `00:${seconds.toString().padStart(2, "0")}`;
}
