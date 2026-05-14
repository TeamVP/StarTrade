import { describe, expect, test } from "vitest";
import { turnTravelProgress } from "./turnTravelProgress";

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
});
