import { describe, expect, test } from "vitest";
import { DEFAULT_GAME_SETTINGS } from "./gameSettings";
import { computeFoodDeliverySettlementPrices } from "./foodTradeSettlement";

describe("computeFoodDeliverySettlementPrices", () => {
  test("settles food at the pre-delivery market price before stock normalises", () => {
    const result = computeFoodDeliverySettlementPrices({
      stockFoodBefore: 0,
      cargoUnits: 1_000,
      foodDemand: 50,
      subsidyPerUnit: 0,
      settings: DEFAULT_GAME_SETTINGS,
    });

    expect(result.settlementUnitPrice).toBeGreaterThan(result.postDeliveryUnitPrice);
    expect(result.postDeliveryUnitPrice).toBeCloseTo(1.8);
    expect(result.clearingPaymentCredits).toBe(
      Math.round(result.settlementUnitPrice * 1_000),
    );
  });

  test("adds import subsidy to the nominal invoice without changing the market price", () => {
    const result = computeFoodDeliverySettlementPrices({
      stockFoodBefore: 25,
      cargoUnits: 100,
      foodDemand: 50,
      subsidyPerUnit: 4,
      settings: DEFAULT_GAME_SETTINGS,
    });

    expect(result.nominalUnitPrice).toBe(result.settlementUnitPrice + 4);
    expect(result.desiredSubsidyTotal).toBe(400);
    expect(result.nominalPaymentCredits).toBe(result.clearingPaymentCredits + 400);
  });
});
