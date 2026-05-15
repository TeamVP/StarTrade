import { describe, expect, test } from "vitest";
import { turnTravelArrivalAlpha, turnTravelProgress } from "./turnTravelProgress";

const turnDurationMs = 10_000;
const turnStartedAt = 100_000;

describe("turnTravelProgress", () => {
  test("uses the full turn duration for a one-turn voyage", () => {
    const base = {
      currentTurn: 6,
      dispatchedTurn: 5,
      etaTurn: 6,
      travelTurnsTotal: 1,
      turnStartedAt,
      turnDurationMs,
    };

    expect(turnTravelProgress({ ...base, now: turnStartedAt })).toBe(0);
    expect(turnTravelProgress({ ...base, now: turnStartedAt + turnDurationMs / 2 })).toBe(0.5);
    expect(turnTravelProgress({ ...base, now: turnStartedAt + turnDurationMs })).toBe(1);
  });

  test("is continuous across turn boundaries for multi-turn voyages", () => {
    const previousTurnEnd = turnTravelProgress({
      now: turnStartedAt + turnDurationMs,
      currentTurn: 6,
      dispatchedTurn: 5,
      etaTurn: 8,
      travelTurnsTotal: 3,
      turnStartedAt,
      turnDurationMs,
    });
    const nextTurnStart = turnTravelProgress({
      now: turnStartedAt + turnDurationMs,
      currentTurn: 7,
      dispatchedTurn: 5,
      etaTurn: 8,
      travelTurnsTotal: 3,
      turnStartedAt: turnStartedAt + turnDurationMs,
      turnDurationMs,
    });

    expect(previousTurnEnd).toBeCloseTo(1 / 3);
    expect(nextTurnStart).toBeCloseTo(previousTurnEnd);
  });

  test("continues moving during resolution overrun and matches delayed handoff", () => {
    const overrunNow = turnStartedAt + turnDurationMs * 1.5;
    const resolvingProgress = turnTravelProgress({
      now: overrunNow,
      currentTurn: 6,
      dispatchedTurn: 5,
      etaTurn: 8,
      travelTurnsTotal: 3,
      turnStartedAt,
      turnDurationMs,
    });
    const nextTurnProgress = turnTravelProgress({
      now: overrunNow,
      currentTurn: 7,
      dispatchedTurn: 5,
      etaTurn: 8,
      travelTurnsTotal: 3,
      turnStartedAt: turnStartedAt + turnDurationMs,
      turnDurationMs,
    });

    expect(resolvingProgress).toBeCloseTo(0.5);
    expect(nextTurnProgress).toBeCloseTo(resolvingProgress);
  });

  test("starts departing during the resolution overrun before next-turn handoff", () => {
    const resolvingProgress = turnTravelProgress({
      now: turnStartedAt + turnDurationMs * 1.25,
      currentTurn: 5,
      dispatchedTurn: 5,
      etaTurn: 7,
      travelTurnsTotal: 2,
      turnStartedAt,
      turnDurationMs,
    });
    const nextTurnProgress = turnTravelProgress({
      now: turnStartedAt + turnDurationMs * 1.25,
      currentTurn: 6,
      dispatchedTurn: 5,
      etaTurn: 7,
      travelTurnsTotal: 2,
      turnStartedAt: turnStartedAt + turnDurationMs,
      turnDurationMs,
    });

    expect(resolvingProgress).toBeCloseTo(0.125);
    expect(nextTurnProgress).toBeCloseTo(resolvingProgress);
  });

  test("keeps moving toward the next-turn position before delayed handoff", () => {
    expect(
      turnTravelProgress({
        now: turnStartedAt + turnDurationMs * 1.25,
        currentTurn: 6,
        dispatchedTurn: 5,
        etaTurn: 8,
        travelTurnsTotal: 3,
        turnStartedAt,
        turnDurationMs,
      }),
    ).toBeCloseTo(5 / 12);
  });

  test("uses etaTurn as the canonical leg length when available", () => {
    expect(
      turnTravelProgress({
        now: turnStartedAt + turnDurationMs / 2,
        currentTurn: 7,
        dispatchedTurn: 5,
        etaTurn: 9,
        travelTurnsTotal: 99,
        turnStartedAt,
        turnDurationMs,
      }),
    ).toBeCloseTo(0.375);
  });

  test("keeps delivered voyages at the destination during their final visible turn", () => {
    expect(
      turnTravelProgress({
        now: turnStartedAt + turnDurationMs,
        currentTurn: 6,
        dispatchedTurn: 5,
        etaTurn: 6,
        travelTurnsTotal: 1,
        turnStartedAt,
        turnDurationMs,
      }),
    ).toBe(1);
    expect(
      turnTravelProgress({
        now: turnStartedAt,
        currentTurn: 7,
        dispatchedTurn: 5,
        etaTurn: 6,
        travelTurnsTotal: 1,
        turnStartedAt,
        turnDurationMs,
      }),
    ).toBe(1);
  });

  test("fades out during the final 0.3 seconds before arrival", () => {
    expect(
      turnTravelArrivalAlpha({
        progress: 0.95,
        dispatchedTurn: 5,
        etaTurn: 6,
        travelTurnsTotal: 1,
        turnDurationMs,
      }),
    ).toBe(1);
    expect(
      turnTravelArrivalAlpha({
        progress: 0.985,
        dispatchedTurn: 5,
        etaTurn: 6,
        travelTurnsTotal: 1,
        turnDurationMs,
      }),
    ).toBeCloseTo(0.5);
    expect(
      turnTravelArrivalAlpha({
        progress: 1,
        dispatchedTurn: 5,
        etaTurn: 6,
        travelTurnsTotal: 1,
        turnDurationMs,
      }),
    ).toBe(0);
  });
});
