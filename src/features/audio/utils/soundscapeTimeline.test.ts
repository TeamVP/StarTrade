import { describe, expect, test } from "vitest";
import {
  buildSoundscapePlaybackPlan,
  computeSoundscapeReverbTailSeconds,
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

  test("keeps reverb tails longer than a typical turn", () => {
    expect(computeSoundscapeReverbTailSeconds(10_000)).toBeGreaterThan(10);
    expect(computeSoundscapeReverbTailSeconds(null)).toBe(12);
  });
});