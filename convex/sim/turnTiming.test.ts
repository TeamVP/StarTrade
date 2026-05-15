import { describe, expect, test } from "vitest";
import { scheduledNextTurnStartedAt, turnDurationHasElapsed } from "./turnTiming";

describe("turnDurationHasElapsed", () => {
  test("does not allow resolution before the configured turn duration", () => {
    expect(
      turnDurationHasElapsed({
        nowMs: 14_999,
        turnStartedAtMs: 5_000,
        turnDurationMs: 10_000,
      }),
    ).toBe(false);
  });

  test("allows resolution once the configured turn duration has elapsed", () => {
    expect(
      turnDurationHasElapsed({
        nowMs: 15_000,
        turnStartedAtMs: 5_000,
        turnDurationMs: 10_000,
      }),
    ).toBe(true);
  });

  test("schedules the next turn at the exact prior turn boundary", () => {
    expect(
      scheduledNextTurnStartedAt({
        turnStartedAtMs: 5_000,
        turnDurationMs: 10_000,
      }),
    ).toBe(15_000);
  });
});
