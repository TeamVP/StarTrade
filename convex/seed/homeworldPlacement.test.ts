import { describe, expect, test } from "vitest";
import { chooseBalancedHomeworldPlacement } from "./homeworldPlacement";
import { V1_TWENTY_SYSTEMS } from "./v1Twenty";
import { V1_MEDIUM_SYSTEMS } from "./v1Medium";

const cornerMap = [
  { key: "nw", x: 0, y: 0, resourceRichness: 0.6 },
  { key: "ne", x: 100, y: 0, resourceRichness: 0.6 },
  { key: "sw", x: 0, y: 100, resourceRichness: 0.6 },
  { key: "se", x: 100, y: 100, resourceRichness: 0.6 },
  { key: "center", x: 50, y: 50, resourceRichness: 0.95 },
];

describe("chooseBalancedHomeworldPlacement", () => {
  test("is deterministic for the same seed", () => {
    const a = chooseBalancedHomeworldPlacement({
      systems: V1_MEDIUM_SYSTEMS,
      count: 6,
      seed: "same-seed",
    });
    const b = chooseBalancedHomeworldPlacement({
      systems: V1_MEDIUM_SYSTEMS,
      count: 6,
      seed: "same-seed",
    });

    expect(a.homeworldKeys).toEqual(b.homeworldKeys);
  });

  test("prefers separated starts over a rich central dogpile", () => {
    const placement = chooseBalancedHomeworldPlacement({
      systems: cornerMap,
      count: 4,
      seed: "corner-seed",
    });

    expect(placement.homeworldKeys).not.toContain("center");
    expect(new Set(placement.homeworldKeys).size).toBe(4);
  });

  test("keeps medium starts reasonably separated", () => {
    const placement = chooseBalancedHomeworldPlacement({
      systems: V1_MEDIUM_SYSTEMS,
      count: 8,
      seed: "medium-balance",
    });

    expect(placement.homeworldKeys).toHaveLength(8);
    expect(placement.minNearestDistance).toBeGreaterThan(280);
    expect(placement.nearestDistanceSpread).toBeLessThan(260);
  });

  test("keeps twenty-system starts reasonably separated", () => {
    const placement = chooseBalancedHomeworldPlacement({
      systems: V1_TWENTY_SYSTEMS,
      count: 4,
      seed: "twenty-balance",
    });

    expect(placement.homeworldKeys).toHaveLength(4);
    expect(placement.minNearestDistance).toBeGreaterThan(230);
    expect(placement.nearestDistanceSpread).toBeLessThan(180);
  });

  test("rejects impossible placement counts", () => {
    expect(() =>
      chooseBalancedHomeworldPlacement({
        systems: cornerMap,
        count: 6,
        seed: "too-many",
      }),
    ).toThrow(/Cannot place 6 homeworlds/);
  });
});
