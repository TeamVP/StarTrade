import { describe, expect, test } from "vitest";
import {
  estimateServerClockOffsetMs,
  getServerAlignedNowMs,
  getTurnEffectiveNowMs,
  getTurnElapsedFraction,
  getTurnTimeRemaining,
} from "./turnClock";

describe("turnClock", () => {
  test("uses the live clock while the game is running", () => {
    expect(
      getTurnEffectiveNowMs({
        nowMs: 14_500,
        gameStatus: "running",
        turnPausedAtMs: 11_000,
      }),
    ).toBe(14_500);
  });

  test("estimates server clock offset from a received server timestamp", () => {
    expect(
      estimateServerClockOffsetMs({
        serverNowMs: 15_050,
        clientReceivedAtMs: 15_000,
      }),
    ).toBe(50);
  });

  test("produces a server-aligned now from the stored offset", () => {
    expect(
      getServerAlignedNowMs({
        clientNowMs: 20_000,
        serverClockOffsetMs: 50,
      }),
    ).toBe(20_050);
  });

  test("freezes the effective clock at the pause instant", () => {
    expect(
      getTurnEffectiveNowMs({
        nowMs: 14_500,
        gameStatus: "paused",
        turnPausedAtMs: 11_000,
      }),
    ).toBe(11_000);
  });

  test("computes turn progress from the paused effective clock", () => {
    expect(
      getTurnElapsedFraction({
        turnStartedAtMs: 5_000,
        turnDurationMs: 10_000,
        nowMs: 14_500,
        gameStatus: "paused",
        turnPausedAtMs: 11_000,
      }),
    ).toBeCloseTo(0.6);
  });

  test("returns remaining time from the supplied effective clock", () => {
    expect(getTurnTimeRemaining(5_000, 10_000, 11_000)).toBe(4_000);
  });
});