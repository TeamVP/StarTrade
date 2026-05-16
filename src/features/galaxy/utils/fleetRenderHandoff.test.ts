import { describe, expect, test } from "vitest";
import {
  resolveGhostRenderState,
  shouldFadeInFleetMarker,
} from "./fleetRenderHandoff";

describe("resolveGhostRenderState", () => {
  test("keeps fleets visible at the destination until the idle marker exists", () => {
    expect(
      resolveGhostRenderState({
        variant: "fleet",
        progress: 1,
        markerVisible: false,
      }),
    ).toEqual({ drawGhost: true, renderFraction: 1 });
  });

  test("hands fleets off immediately once the idle marker exists", () => {
    expect(
      resolveGhostRenderState({
        variant: "fleet",
        progress: 1,
        markerVisible: true,
      }),
    ).toEqual({ drawGhost: false, renderFraction: 1 });
  });

  test("keeps colony ghosts on their interpolation path", () => {
    expect(
      resolveGhostRenderState({
        variant: "colony",
        progress: 0.62,
        markerVisible: false,
      }),
    ).toEqual({ drawGhost: true, renderFraction: 0.62 });
  });
});

describe("shouldFadeInFleetMarker", () => {
  test("skips fade-in when the travel ghost is still visible", () => {
    expect(
      shouldFadeInFleetMarker({ ghostVisibleNow: true, ghostRecentlyVisible: false }),
    ).toBe(false);
  });

  test("skips fade-in during the recent-ghost grace window", () => {
    expect(
      shouldFadeInFleetMarker({ ghostVisibleNow: false, ghostRecentlyVisible: true }),
    ).toBe(false);
  });

  test("fades in markers that appear without a visible handoff", () => {
    expect(
      shouldFadeInFleetMarker({ ghostVisibleNow: false, ghostRecentlyVisible: false }),
    ).toBe(true);
  });
});