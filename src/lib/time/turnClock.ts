export function getTurnTimeRemaining(
  turnStartedAtMs: number,
  turnDurationMs: number,
  nowMs: number,
) {
  const elapsed = Math.max(0, nowMs - turnStartedAtMs);
  return Math.max(0, turnDurationMs - elapsed);
}

export function formatMsAsClock(ms: number) {
  const totalSeconds = Math.ceil(ms / 1000);
  const seconds = Math.max(0, totalSeconds);
  return `00:${seconds.toString().padStart(2, "0")}`;
}
