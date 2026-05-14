import { describe, expect, test } from "vitest";
import {
  nextOwnershipInvalidTurns,
  shouldCancelGarrisonRouteForEndpointAvailability,
  shouldDeferAutomatedGarrisonForManualMoveLock,
} from "./garrisonRoutes";
import type { Id } from "../_generated/dataModel";
import {
  hasManualOrderOriginLock,
  manualOrderOriginKey,
} from "./fleetOrders";

describe("nextOwnershipInvalidTurns", () => {
  test("increments while the origin or destination is unavailable", () => {
    expect(
      nextOwnershipInvalidTurns({
        originOwned: true,
        destinationAvailable: false,
        currentInvalidTurns: 2,
      }),
    ).toBe(3);
  });

  test("resets when the origin is owned and destination exists", () => {
    expect(
      nextOwnershipInvalidTurns({
        originOwned: true,
        destinationAvailable: true,
        currentInvalidTurns: 3,
      }),
    ).toBe(0);
  });

  test("does not cancel just because the destination is not owned", () => {
    expect(
      shouldCancelGarrisonRouteForEndpointAvailability({
        originOwned: true,
        destinationAvailable: true,
      }),
    ).toBe(false);
  });

  test("cancels when the origin is lost or destination disappears", () => {
    expect(
      shouldCancelGarrisonRouteForEndpointAvailability({
        originOwned: false,
        destinationAvailable: true,
      }),
    ).toBe(true);
    expect(
      shouldCancelGarrisonRouteForEndpointAvailability({
        originOwned: true,
        destinationAvailable: false,
      }),
    ).toBe(true);
  });

  test("still reports consecutive invalid turns for telemetry/backwards compatibility", () => {
    const fourthInvalidTurn = nextOwnershipInvalidTurns({
      originOwned: false,
      destinationAvailable: true,
      currentInvalidTurns: 3,
    });

    expect(fourthInvalidTurn).toBe(4);
  });
});

describe("manual order origin locks", () => {
  const empireA = "empireA" as Id<"emp_states">;
  const empireB = "empireB" as Id<"emp_states">;
  const origin = "origin" as Id<"gal_systems">;

  test("defer move lock skips only strategy-origin dispatches", () => {
    const locks = new Set([
      manualOrderOriginKey({ empireId: empireA, originSystemId: origin }),
    ]);

    expect(
      shouldDeferAutomatedGarrisonForManualMoveLock(
        { managedByStrategy: false, empireId: empireA, originSystemId: origin },
        locks,
      ),
    ).toBe(false);

    expect(
      shouldDeferAutomatedGarrisonForManualMoveLock(
        { empireId: empireA, originSystemId: origin },
        locks,
      ),
    ).toBe(false);

    expect(
      shouldDeferAutomatedGarrisonForManualMoveLock(
        { managedByStrategy: true, empireId: empireA, originSystemId: origin },
        locks,
      ),
    ).toBe(true);
  });

  test("locks the ordered origin only for that empire", () => {
    const locks = new Set([
      manualOrderOriginKey({ empireId: empireA, originSystemId: origin }),
    ]);

    expect(
      hasManualOrderOriginLock(locks, {
        empireId: empireA,
        originSystemId: origin,
      }),
    ).toBe(true);
    expect(
      hasManualOrderOriginLock(locks, {
        empireId: empireB,
        originSystemId: origin,
      }),
    ).toBe(false);
  });

  test("treats absent locks as automation-available", () => {
    expect(
      hasManualOrderOriginLock(undefined, {
        empireId: empireA,
        originSystemId: origin,
      }),
    ).toBe(false);
  });
});
