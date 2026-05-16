import { describe, expect, test } from "vitest";
import {
  committedNextTurnStartedAt,
  msUntilTurnBoundary,
  resumedTurnStartedAt,
  scheduledNextTurnStartedAt,
  shiftPausedDeadline,
  turnDurationHasElapsed,
} from "./turnTiming";

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

  test("shifts the active turn start forward by the paused duration on resume", () => {
    expect(
      resumedTurnStartedAt({
        turnStartedAtMs: 5_000,
        pausedAtMs: 11_000,
        resumedAtMs: 14_500,
      }),
    ).toBe(8_500);
  });

  test("shifts delayed auto-resolve deadlines by the paused duration", () => {
    expect(
      shiftPausedDeadline({
        deadlineMs: 20_000,
        pausedAtMs: 11_000,
        resumedAtMs: 14_500,
      }),
    ).toBe(23_500);
  });

  test("computes the remaining delay until the stored turn boundary", () => {
    expect(
      msUntilTurnBoundary({
        nowMs: 12_250,
        turnStartedAtMs: 5_000,
        turnDurationMs: 10_000,
      }),
    ).toBe(2_750);
  });

  test("keeps the exact boundary when preparation finished before commit time", () => {
    expect(
      committedNextTurnStartedAt({
        turnStartedAtMs: 5_000,
        turnDurationMs: 10_000,
        preparedAtMs: 14_750,
        committedAtMs: 15_000,
      }),
    ).toBe(15_000);
  });

  test("starts the next turn at commit time when preparation finishes late", () => {
    expect(
      committedNextTurnStartedAt({
        turnStartedAtMs: 5_000,
        turnDurationMs: 10_000,
        preparedAtMs: 15_900,
        committedAtMs: 15_900,
      }),
    ).toBe(15_900);
  });
});
