import type { Id } from "../../_generated/dataModel";
import type { MutationCtx } from "../../_generated/server";
import { NPC_TRADER_CATALOG_SIZE } from "../../seed/npcTraderCatalog";
import { loadTraderEconomyGame } from "../gameMode";
import {
  BG_TRADER_AUTOMATION_INCREASE_EARNINGS_TO_COST_RATIO,
  BG_TRADER_AUTOMATION_MIN_NPC_DELIVERIES_IN_WINDOW,
} from "./constants";
import { DEFAULT_GAME_SETTINGS, loadGameSettings } from "./gameSettings";

/**
 * After each full block of 10 resolved turns, when `traderLimitsAutomated` is on,
 * raises or lowers `traderMaxActive` from aggregate NPC delivery economics.
 *
 * Only voyages with a `traderIdentityId` are counted: those are the rows whose P&L is applied
 * to `sim_trader_identities.treasury`. Admin-spawned and other unattributed voyages are ignored
 * so automation stays aligned with NPC balance sheets.
 */
export async function maybeAdjustAutomatedNpcTraderLimits(
  ctx: MutationCtx,
  params: { gameId: Id<"sim_games">; completedTurn: number },
): Promise<void> {
  const { gameId, completedTurn } = params;
  if (completedTurn <= 0 || completedTurn % 10 !== 0) {
    return;
  }

  await loadTraderEconomyGame(ctx, gameId, "maybeAdjustAutomatedNpcTraderLimits");

  const settings = await loadGameSettings(ctx, gameId);
  if (!settings.traderLimitsAutomated) {
    return;
  }

  const fromTurn = completedTurn - 9;
  const toTurn = completedTurn;

  const deliveries = await ctx.db
    .query("eco_bg_traders")
    .withIndex("by_gameId_and_deliveredTurn", (q) =>
      q.eq("gameId", gameId).gte("deliveredTurn", fromTurn).lte("deliveredTurn", toTurn),
    )
    .collect();

  if (deliveries.length === 0) {
    return;
  }

  let sumProfit = 0;
  let sumRevenue = 0;
  let sumCost = 0;
  let counted = 0;
  let profitableCount = 0;

  for (const d of deliveries) {
    if (d.status !== "delivered") continue;
    // Same rows as applyVoyageProfitToNpcIdentity — unattributed voyages must not move the cap.
    if (d.traderIdentityId === undefined || d.traderIdentityId === null) continue;
    if (
      d.deliveryProfit === undefined ||
      d.deliveryRevenue === undefined ||
      d.deliveryCost === undefined
    ) {
      continue;
    }
    sumProfit += d.deliveryProfit;
    sumRevenue += d.deliveryRevenue;
    sumCost += d.deliveryCost;
    counted++;
    if (d.deliveryProfit >= 0) profitableCount++;
  }

  if (counted < BG_TRADER_AUTOMATION_MIN_NPC_DELIVERIES_IN_WINDOW) {
    return;
  }

  const avgProfit = sumProfit / counted;
  const currentMax = settings.traderMaxActive;
  let nextMax = currentMax;

  if (avgProfit < 0) {
    nextMax = Math.max(1, currentMax - 1);
  } else if (
    sumCost > 0 &&
    sumRevenue / sumCost > BG_TRADER_AUTOMATION_INCREASE_EARNINGS_TO_COST_RATIO &&
    // Without this, a few huge winning voyages can make Σ revenue / Σ cost > 1.4 even when
    // most trips lose — which does not match healthy NPC trading or player expectations.
    profitableCount * 2 >= counted
  ) {
    nextMax = Math.min(NPC_TRADER_CATALOG_SIZE, currentMax + 1);
  }

  nextMax = Math.max(settings.traderMinActive, nextMax);
  nextMax = Math.max(1, nextMax);

  if (nextMax === currentMax) {
    return;
  }

  const existing = await ctx.db
    .query("sim_game_settings")
    .withIndex("by_gameId", (q) => q.eq("gameId", gameId))
    .unique();

  if (existing !== null) {
    await ctx.db.patch("sim_game_settings", existing._id, {
      traderMaxActive: nextMax,
    });
    return;
  }

  const baseSettings = DEFAULT_GAME_SETTINGS;
  await ctx.db.insert("sim_game_settings", {
    gameId,
    foodProdMult: baseSettings.foodProdMult,
    shipProdMult: baseSettings.shipProdMult,
    popGrowthMult: baseSettings.popGrowthMult,
    taxMult: baseSettings.taxMult,
    foodPriceElasticityMult: baseSettings.foodPriceElasticityMult,
    starvationMult: baseSettings.starvationMult,
    starvationFoodPriceCapMult: baseSettings.starvationFoodPriceCapMult,
    traderShipCostMult: baseSettings.traderShipCostMult,
    combatAttackMult: baseSettings.combatAttackMult,
    combatDefendMult: baseSettings.combatDefendMult,
    collateralDamageMult: baseSettings.collateralDamageMult,
    shipProdEmphasisPower: baseSettings.shipProdEmphasisPower,
    traderMinActive: baseSettings.traderMinActive,
    traderMaxActive: nextMax,
    traderShipHirePerTurn: baseSettings.traderShipHirePerTurn,
    traderHireChancePct: baseSettings.traderHireChancePct,
    traderDockingCost: baseSettings.traderDockingCost,
    foodStockpileMaxPerPop: baseSettings.foodStockpileMaxPerPop,
    foodStockpileMinPerPop: baseSettings.foodStockpileMinPerPop,
    foodStressFactor: baseSettings.foodStressFactor,
    combatDefenderAdvantage: baseSettings.combatDefenderAdvantage,
    foodBasePrice: baseSettings.foodBasePrice,
    combatFoodDamageMult: baseSettings.combatFoodDamageMult,
    traderLimitsAutomated: baseSettings.traderLimitsAutomated,
  });
}
