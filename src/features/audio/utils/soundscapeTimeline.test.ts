import { describe, expect, test } from "vitest";
import {
  buildSoundscapePlaybackPlan,
  computeSoundscapeReverbTailSeconds,
  shouldSuppressSoundscapeUntilTurnAdvance,
  type SoundscapeTimelineSnapshot,
} from "./soundscapeTimeline";

const timeline: SoundscapeTimelineSnapshot = {
  currentTurn: 8,
  turnStartedAt: 100_000,
  turnDurationMs: 10_000,
  effectiveNowMs: 100_000,
};

describe("soundscapeTimeline", () => {
  test("spreads current-turn events across the active turn window", () => {
    const plan = buildSoundscapePlaybackPlan({
      events: [
        { _id: "evt-1", turnNumber: 8 },
        { _id: "evt-2", turnNumber: 8 },
        { _id: "evt-3", turnNumber: 8 },
      ],
      timeline,
    });

    expect(plan).toHaveLength(3);
    expect(plan[0]?.delayMs).toBeGreaterThanOrEqual(1000);
    expect(plan[1]?.delayMs).toBeGreaterThan(plan[0]?.delayMs ?? 0);
    expect(plan[2]?.delayMs).toBeGreaterThan(plan[1]?.delayMs ?? 0);
  });

  test("front-loads prior-turn events near the start of the current turn", () => {
    const plan = buildSoundscapePlaybackPlan({
      events: [
        { _id: "evt-prev", turnNumber: 7 },
        { _id: "evt-current", turnNumber: 8 },
      ],
      timeline,
    });

    expect(plan[0]?.delayMs).toBeLessThan(plan[1]?.delayMs ?? 0);
    expect(plan[0]?.delayMs).toBeLessThan(3000);
  });

  test("falls back to immediate playback without a turn timeline", () => {
    const plan = buildSoundscapePlaybackPlan({
      events: [{ _id: "evt-1", turnNumber: 8 }],
      timeline: null,
    });

    expect(plan).toEqual([{ eventId: "evt-1", delayMs: 0, slotFraction: 0.5 }]);
  });

  test("suppresses playback until the turn advances after startup", () => {
    expect(
      shouldSuppressSoundscapeUntilTurnAdvance({
        armedTurnNumber: 8,
        currentTurnNumber: 8,
      }),
    ).toBe(true);
    expect(
      shouldSuppressSoundscapeUntilTurnAdvance({
        armedTurnNumber: 8,
        currentTurnNumber: 9,
      }),
    ).toBe(false);
    expect(
      shouldSuppressSoundscapeUntilTurnAdvance({
        armedTurnNumber: null,
        currentTurnNumber: 8,
      }),
    ).toBe(false);
  });

  test("keeps reverb tails present without carrying across many turns", () => {
    expect(computeSoundscapeReverbTailSeconds(10_000)).toBeCloseTo(8);
    expect(computeSoundscapeReverbTailSeconds(null)).toBe(8);
  });
});