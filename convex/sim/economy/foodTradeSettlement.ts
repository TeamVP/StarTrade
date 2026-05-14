import type { GameSettings } from "./gameSettings";
import { computeSystemFoodPrice } from "./foodPricing";

type FoodTradeSettlementSettings = Pick<
  GameSettings,
  | "foodPriceElasticityMult"
  | "starvationFoodPriceCapMult"
  | "foodStockpileMaxPerPop"
  | "foodStockpileMinPerPop"
  | "foodStressFactor"
  | "foodBasePrice"
>;

export type FoodDeliverySettlementPrices = {
  settlementUnitPrice: number;
  postDeliveryUnitPrice: number;
  nominalUnitPrice: number;
  desiredSubsidyTotal: number;
  clearingPaymentCredits: number;
  nominalPaymentCredits: number;
};

/**
 * Food sales settle at the destination's current market price. The delivered
 * food then updates local stock and the next visible market price.
 */
export function computeFoodDeliverySettlementPrices(params: {
  stockFoodBefore: number;
  cargoUnits: number;
  foodDemand: number;
  subsidyPerUnit: number;
  settings: FoodTradeSettlementSettings;
  /**
   * Market clearing price already stamped by applyTurnEconomy (`gal_systems.foodPrice`).
   * Recomputing here without same-turn `foodNet` understated crisis prices vs what traders
   * assume at dispatch; prefer the stored figure when present.
   */
  marketUnitPriceBeforeDelivery?: number;
}): FoodDeliverySettlementPrices {
  const stockFoodBefore = Math.max(0, params.stockFoodBefore);
  const cargoUnits = Math.max(0, params.cargoUnits);
  const subsidyPerUnit = Math.max(0, params.subsidyPerUnit);

  const settlementUnitPrice =
    params.marketUnitPriceBeforeDelivery !== undefined &&
    Number.isFinite(params.marketUnitPriceBeforeDelivery)
      ? Math.max(0, params.marketUnitPriceBeforeDelivery)
      : computeSystemFoodPrice({
          stockFood: stockFoodBefore,
          foodDemand: params.foodDemand,
          settings: params.settings,
        });
  const postDeliveryUnitPrice = computeSystemFoodPrice({
    stockFood: stockFoodBefore + cargoUnits,
    foodDemand: params.foodDemand,
    settings: params.settings,
  });
  const desiredSubsidyTotal = cargoUnits * subsidyPerUnit;

  return {
    settlementUnitPrice,
    postDeliveryUnitPrice,
    nominalUnitPrice: settlementUnitPrice + subsidyPerUnit,
    desiredSubsidyTotal,
    clearingPaymentCredits: Math.round(cargoUnits * settlementUnitPrice),
    nominalPaymentCredits:
      Math.round(cargoUnits * settlementUnitPrice) + Math.round(desiredSubsidyTotal),
  };
}
