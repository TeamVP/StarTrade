/**
 * Background NPC trader system (PRD §6 — background off-screen trade).
 *
 * Each turn this function:
 *  1. Delivers cargo for traders whose ETA has arrived.
 *  2. Evaluates food arbitrage across any lane-connected origin/destination pair (multi-hop).
 *  3. Spawns traders on the most profitable viable routes (up to global and per-system caps).
 *
 * Traders are autonomous economic agents — not player-controlled. They:
 *  - Pay a per-turn ship-hire cost while in transit.
 *  - Pay a one-time docking fee at the destination.
 *  - Only depart when expected revenue clears BG_TRADER_MIN_REVENUE_TO_COST_RATIO
 *    versus full voyage cost (cargo purchase + ship hire + docking).
 *
 * Price effect:
 *  - Buying at origin reduces its stockFood → price rises (oversupply normalises).
 *    Purchases come only from food **above** the stockpile ceiling (demand × foodStockpileMaxPerPop);
 *    cargo is min(full hold, that oversupply), so runs can be smaller than BG_TRADER_CARGO_SIZE.
 *  - Delivering to dest sells at the current local price, then increases stockFood
 *    so the next market price falls if the shortage is normalised.
 *  - Sale proceeds are debited from the destination payer: owning empire’s treasury first, then a
 *    balance-controlled share of the remaining invoice from `localTreasury`. Unowned systems use
 *    only local treasury.
 */

import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx } from "../../_generated/server";
import { internalMutation } from "../../_generated/server";
import { v } from "convex/values";
import type { GameSettings } from "./gameSettings";
import { loadGameSettings } from "./gameSettings";
import { computeSystemFoodPrice, foodOversupplyUnits } from "./foodPricing";
import { computeFoodDeliverySettlementPrices } from "./foodTradeSettlement";
import { travelTurnsFromLinkCost } from "../fleetDispatch";
import {
  BG_TRADER_CARGO_SIZE,
  BG_TRADER_MAX_DEPARTURES_PER_SYSTEM,
  BG_TRADER_MAX_NEW_PER_TURN,
  FOOD_PER_POP,
} from "./constants";
import {
  buildUndirectedHyperlaneAdjacency,
  shortestTravelTurnsBetween,
} from "../../gal/hyperlaneGraph";
import {
  evaluateTraderProfitability,
  localCommodityUnitPrice,
  traderFoodSellPricePerUnit,
} from "../../eco/traderEconomics";
import {
  applyVoyageProfitToNpcIdentity,
  ensureNpcTraderIdentitiesForGame,
  pickNpcIdentityForNewVoyage,
  refillActiveNpcIdentities,
} from "./npcTraderRuntime";

type DeliverTraderSettings = Pick<
  GameSettings,
  | "foodPriceElasticityMult"
  | "starvationFoodPriceCapMult"
  | "foodStockpileMaxPerPop"
  | "foodStockpileMinPerPop"
  | "foodStressFactor"
  | "foodBasePrice"
  | "traderDockingCost"
  | "localTreasuryAddsPer100Cr"
  | "traderMaxActive"
>;

/** Split `total` across positive integer weights; sums to `total`. */
function splitProportionalInt(total: number, weights: readonly number[]): number[] {
  const n = weights.length;
  if (n === 0) return [];
  const sumW = weights.reduce((a, b) => a + b, 0);
  if (sumW <= 0) return weights.map(() => 0);
  const out: number[] = [];
  let allocated = 0;
  for (let i = 0; i < n - 1; i++) {
    const s = Math.floor((total * weights[i]) / sumW);
    out.push(s);
    allocated += s;
  }
  out.push(total - allocated);
  return out;
}

function localTreasuryShortfallTopUp(params: {
  shortfall: number;
  localAvailable: number;
  ownerEmpireId: Id<"emp_states"> | null;
  settings: Pick<GameSettings, "localTreasuryAddsPer100Cr">;
}): number {
  const shortfall = Math.max(0, params.shortfall);
  const localAvailable = Math.max(0, params.localAvailable);
  if (shortfall <= 0 || localAvailable <= 0) return 0;
  if (params.ownerEmpireId === null) return Math.min(shortfall, localAvailable);

  const addsPer100 = Math.max(0, Math.min(100, params.settings.localTreasuryAddsPer100Cr));
  return Math.min(localAvailable, (shortfall * addsPer100) / 100);
}

async function applyTraderBoycottsIfUnderpaid(
  ctx: MutationCtx,
  params: {
    turnNumber: number;
    dest: Doc<"gal_systems">;
    underpaidOwnedEmpire: boolean;
    underpaidUnownedSystem: boolean;
  },
): Promise<void> {
  const { turnNumber, dest } = params;
  if (params.underpaidOwnedEmpire && dest.ownerEmpireId !== null) {
    const boycottUntil = turnNumber + 30;
    const empire = await ctx.db.get("emp_states", dest.ownerEmpireId);
    if (
      empire !== null &&
      (empire.traderBoycottUntilTurn === undefined ||
        empire.traderBoycottUntilTurn < boycottUntil)
    ) {
      await ctx.db.patch("emp_states", empire._id, { traderBoycottUntilTurn: boycottUntil });
    }
  }
  if (params.underpaidUnownedSystem && dest.ownerEmpireId === null) {
    const boycottUntil = turnNumber + 30;
    const current = await ctx.db.get("gal_systems", dest._id);
    if (
      current !== null &&
      current.ownerEmpireId === null &&
      (current.traderBoycottUntilTurn === undefined ||
        current.traderBoycottUntilTurn < boycottUntil)
    ) {
      await ctx.db.patch("gal_systems", current._id, { traderBoycottUntilTurn: boycottUntil });
    }
  }
}

/**
 * Settles all food cargo arriving this turn to the same destination in one batch:
 * one current-market clearing price, one treasury withdrawal, then **pro‑rated**
 * credits to each captain. Avoids the first ship taking the entire empire treasury while
 * later ships to the same system are paid almost nothing.
 */
async function settleFoodDeliveriesGroup(
  ctx: MutationCtx,
  group: Doc<"eco_bg_traders">[],
  params: { gameId: Id<"sim_games">; turnNumber: number; settings: DeliverTraderSettings },
): Promise<void> {
  if (group.length === 0) return;

  const sorted = [...group].sort((a, b) => {
    if (a.dispatchedTurn !== b.dispatchedTurn) return a.dispatchedTurn - b.dispatchedTurn;
    return a._id < b._id ? -1 : a._id > b._id ? 1 : 0;
  });

  const destId = sorted[0].destinationSystemId;
  const dest0 = await ctx.db.get("gal_systems", destId);
  if (dest0 === null) {
    for (const t of sorted) {
      await ctx.db.patch("eco_bg_traders", t._id, { status: "cancelled" });
    }
    return;
  }
  let dest = dest0;

  const totalCargo = sorted.reduce((s, t) => s + t.cargoUnits, 0);
  const stockFoodBefore = Math.max(0, dest.stockFood ?? 0);
  const newStock = stockFoodBefore + totalCargo;
  const foodDemand = estimateFoodDemand(dest);
  const subsidyPerUnit = Math.max(0, dest.foodImportSubsidyPerUnit ?? 0);
  const dockingRevenue = sorted.length * params.settings.traderDockingCost;
  const settlementPrices = computeFoodDeliverySettlementPrices({
    stockFoodBefore,
    cargoUnits: totalCargo,
    foodDemand,
    subsidyPerUnit,
    settings: params.settings,
    marketUnitPriceBeforeDelivery: dest0.foodPrice,
  });
  const clearingPrice = settlementPrices.settlementUnitPrice;
  const postDeliveryPrice = settlementPrices.postDeliveryUnitPrice;
  const desiredSubsidyTotal = settlementPrices.desiredSubsidyTotal;
  const clearingPaymentInt = settlementPrices.clearingPaymentCredits;
  const nominalTotal = settlementPrices.nominalPaymentCredits;
  const nominalUnit = settlementPrices.nominalUnitPrice;

  const cargos = sorted.map((t) => t.cargoUnits);
  const invoiceShares = splitProportionalInt(nominalTotal, cargos);

  let paidSubsidyTotal = 0;
  let marketPaid = 0;
  let localPaidTotal = 0;
  let localAvailable = Math.max(0, Math.floor(dest.localTreasury ?? 0));
  let underpaidOwnedEmpire = false;
  let underpaidUnownedSystem = false;

  if (desiredSubsidyTotal > 0) {
    let subsidyRemaining = desiredSubsidyTotal;
    if (dest.ownerEmpireId !== null) {
      const empire = await ctx.db.get("emp_states", dest.ownerEmpireId);
      if (empire !== null) {
        const empirePaid = Math.min(subsidyRemaining, Math.max(0, empire.treasury));
        paidSubsidyTotal += empirePaid;
        subsidyRemaining -= empirePaid;
        if (empirePaid > 0) {
          await ctx.db.patch("emp_states", empire._id, {
            treasury: empire.treasury - empirePaid,
          });
        }
      }
    }

    if (subsidyRemaining > 0) {
      const localPaid = localTreasuryShortfallTopUp({
        shortfall: subsidyRemaining,
        localAvailable,
        ownerEmpireId: dest.ownerEmpireId,
        settings: params.settings,
      });
      paidSubsidyTotal += localPaid;
      localPaidTotal += localPaid;
      localAvailable -= localPaid;
    }

    if (paidSubsidyTotal + 1e-6 < desiredSubsidyTotal) {
      if (dest.ownerEmpireId !== null) underpaidOwnedEmpire = true;
      else underpaidUnownedSystem = true;
    }
  }

  if (dest.ownerEmpireId !== null && clearingPaymentInt > 0) {
    const empireAfterSub = await ctx.db.get("emp_states", dest.ownerEmpireId);
    let marketRemaining = clearingPaymentInt;
    if (empireAfterSub !== null) {
      const empirePaid = Math.min(
        marketRemaining,
        Math.max(0, Math.floor(empireAfterSub.treasury)),
      );
      marketPaid += empirePaid;
      marketRemaining -= empirePaid;
      if (empirePaid > 0) {
        await ctx.db.patch("emp_states", empireAfterSub._id, {
          treasury: empireAfterSub.treasury - empirePaid,
        });
      }
    }
    if (marketRemaining > 0) {
      const localPaid = localTreasuryShortfallTopUp({
        shortfall: marketRemaining,
        localAvailable,
        ownerEmpireId: dest.ownerEmpireId,
        settings: params.settings,
      });
      marketPaid += localPaid;
      localPaidTotal += localPaid;
      localAvailable -= localPaid;
    }
    if (marketPaid < clearingPaymentInt) underpaidOwnedEmpire = true;
  } else if (dest.ownerEmpireId === null && clearingPaymentInt > 0) {
    const localPaid = localTreasuryShortfallTopUp({
      shortfall: clearingPaymentInt,
      localAvailable,
      ownerEmpireId: dest.ownerEmpireId,
      settings: params.settings,
    });
    marketPaid += localPaid;
    localPaidTotal += localPaid;
    localAvailable -= localPaid;
    if (marketPaid < clearingPaymentInt) underpaidUnownedSystem = true;
  }

  const totalCredits = Math.round(paidSubsidyTotal) + marketPaid;
  const revenueShares = splitProportionalInt(totalCredits, cargos);

  const perUnitBonusFromPaid = totalCargo > 0 ? paidSubsidyTotal / totalCargo : 0;
  const soldAtPrice = clearingPrice + perUnitBonusFromPaid;

  await ctx.db.patch("gal_systems", dest._id, {
    stockFood: newStock,
    foodPrice: postDeliveryPrice,
    ...(localPaidTotal > 0 || dockingRevenue > 0
      ? {
          localTreasury:
            Math.max(0, (dest.localTreasury ?? 0) - localPaidTotal) + dockingRevenue,
        }
      : {}),
  });

  dest = {
    ...dest,
    stockFood: newStock,
    foodPrice: postDeliveryPrice,
    localTreasury:
      localPaidTotal > 0 || dockingRevenue > 0
        ? Math.max(0, (dest.localTreasury ?? 0) - localPaidTotal) + dockingRevenue
        : dest.localTreasury,
  };

  await applyTraderBoycottsIfUnderpaid(ctx, {
    turnNumber: params.turnNumber,
    dest,
    underpaidOwnedEmpire,
    underpaidUnownedSystem,
  });

  const batchShortfall = Math.max(0, nominalTotal - totalCredits);
  for (let i = 0; i < sorted.length; i++) {
    const trader = sorted[i];
    const creditsFromBuyer = revenueShares[i] ?? 0;
    const invoiceCredits = invoiceShares[i] ?? 0;
    const travelCost =
      trader.shipHireCostPerTurn * trader.travelTurns + params.settings.traderDockingCost;
    const purchaseCost = trader.cargoUnits * trader.boughtAtPrice;
    const profitRounded = Math.round(creditsFromBuyer - purchaseCost - travelCost);
    const shortfall = Math.max(0, invoiceCredits - creditsFromBuyer);
    const shipHire = Math.round(trader.shipHireCostPerTurn * trader.travelTurns);
    const buyerUnderpaid =
      batchShortfall > 0 ||
      shortfall > 0 ||
      paidSubsidyTotal + 1e-6 < desiredSubsidyTotal ||
      marketPaid + 1e-6 < clearingPaymentInt;

    await ctx.db.patch("eco_bg_traders", trader._id, {
      status: "delivered",
      deliveryProfit: profitRounded,
      deliveredTurn: params.turnNumber,
      deliveryRevenue: Math.round(creditsFromBuyer),
      deliveryCost: Math.round(purchaseCost + travelCost),
      deliveryPurchaseCredits: Math.round(purchaseCost),
      deliveryShipHireTotal: shipHire,
      deliveryDockingFee: params.settings.traderDockingCost,
      deliveryClearingUnitPrice: clearingPrice,
      deliveryNominalUnitPrice: nominalUnit,
      deliveryInvoiceCredits: invoiceCredits,
      deliveryTreasuryShortfall: shortfall,
      deliveryBuyerUnderpaid: buyerUnderpaid,
    });

    await applyVoyageProfitToNpcIdentity(ctx, {
      gameId: params.gameId,
      traderIdentityId: trader.traderIdentityId,
      profitRounded,
      traderMaxActive: params.settings.traderMaxActive,
    });

    await ctx.db.insert("sim_events", {
      gameId: params.gameId,
      turnNumber: params.turnNumber,
      eventType: "bg_trader_delivered",
      actorType: "trader",
      actorId: trader._id,
      targetType: "system",
      targetId: dest._id,
      summary: `Trader delivered ${trader.cargoUnits} ${trader.commodity} to ${dest.name} (profit: ${profitRounded} cr)`,
      payload: JSON.stringify({
        traderId: trader._id,
        traderIdentityId: trader.traderIdentityId,
        originSystemId: trader.originSystemId,
        destinationSystemId: dest._id,
        cargoUnits: trader.cargoUnits,
        commodity: trader.commodity,
        boughtAtPrice: trader.boughtAtPrice,
        soldAtPrice,
        clearingPrice,
        postDeliveryFoodPrice: postDeliveryPrice,
        nominalUnitPrice: nominalUnit,
        foodBatchSize: sorted.length,
        travelCost,
        creditsFromBuyer,
        invoiceCredits,
        profit: profitRounded,
      }),
    });
  }
}

async function deliverNonFoodTrader(
  ctx: MutationCtx,
  trader: Doc<"eco_bg_traders">,
  params: { gameId: Id<"sim_games">; turnNumber: number; settings: DeliverTraderSettings },
): Promise<void> {
  const dest = await ctx.db.get("gal_systems", trader.destinationSystemId);
  if (dest === null) {
    await ctx.db.patch("eco_bg_traders", trader._id, { status: "cancelled" });
    return;
  }

  const travelCost =
    trader.shipHireCostPerTurn * trader.travelTurns + params.settings.traderDockingCost;
  const shipHire = Math.round(trader.shipHireCostPerTurn * trader.travelTurns);
  const docking = params.settings.traderDockingCost;

  let soldAtPrice: number;
  let creditsFromBuyer = 0;
  let underpaidOwnedEmpire = false;
  let underpaidUnownedSystem = false;

  if (trader.commodity === "weapons") {
    const newWeapons = Math.max(0, (dest.stockWeapons ?? 0) + trader.cargoUnits);
    const destAfterWeapons: Doc<"gal_systems"> = {
      ...dest,
      stockWeapons: newWeapons,
    };
    soldAtPrice = localCommodityUnitPrice(destAfterWeapons, "weapons");
    const revenueInt = Math.round(trader.cargoUnits * soldAtPrice);
    if (dest.ownerEmpireId !== null) {
      const empire = await ctx.db.get("emp_states", dest.ownerEmpireId);
      const local0 = dest.localTreasury ?? 0;
      let localPaid = 0;
      if (empire !== null) {
        creditsFromBuyer = Math.min(revenueInt, Math.max(0, Math.floor(empire.treasury)));
        if (creditsFromBuyer > 0) {
          await ctx.db.patch("emp_states", empire._id, {
            treasury: empire.treasury - creditsFromBuyer,
          });
        }
      }
      localPaid = localTreasuryShortfallTopUp({
        shortfall: revenueInt - creditsFromBuyer,
        localAvailable: local0,
        ownerEmpireId: dest.ownerEmpireId,
        settings: params.settings,
      });
      creditsFromBuyer += localPaid;
      if (creditsFromBuyer < revenueInt) underpaidOwnedEmpire = true;
      await ctx.db.patch("gal_systems", dest._id, {
        stockWeapons: newWeapons,
        localTreasury: Math.max(0, local0 - localPaid) + docking,
      });
    } else {
      const local0 = dest.localTreasury ?? 0;
      creditsFromBuyer = localTreasuryShortfallTopUp({
        shortfall: revenueInt,
        localAvailable: local0,
        ownerEmpireId: dest.ownerEmpireId,
        settings: params.settings,
      });
      await ctx.db.patch("gal_systems", dest._id, {
        stockWeapons: newWeapons,
        localTreasury: Math.max(0, local0 - creditsFromBuyer) + docking,
      });
      if (creditsFromBuyer < revenueInt) underpaidUnownedSystem = true;
    }

    const purchaseCost = trader.cargoUnits * trader.boughtAtPrice;
    const profitRounded = Math.round(creditsFromBuyer - purchaseCost - travelCost);
    const shortfall = Math.max(0, revenueInt - creditsFromBuyer);

    await ctx.db.patch("eco_bg_traders", trader._id, {
      status: "delivered",
      deliveryProfit: profitRounded,
      deliveredTurn: params.turnNumber,
      deliveryRevenue: Math.round(creditsFromBuyer),
      deliveryCost: Math.round(purchaseCost + travelCost),
      deliveryPurchaseCredits: Math.round(purchaseCost),
      deliveryShipHireTotal: shipHire,
      deliveryDockingFee: docking,
      deliveryNominalUnitPrice: soldAtPrice,
      deliveryInvoiceCredits: revenueInt,
      deliveryTreasuryShortfall: shortfall,
      deliveryBuyerUnderpaid: shortfall > 0,
    });

    await applyTraderBoycottsIfUnderpaid(ctx, {
      turnNumber: params.turnNumber,
      dest: { ...dest, stockWeapons: newWeapons },
      underpaidOwnedEmpire,
      underpaidUnownedSystem,
    });

    await applyVoyageProfitToNpcIdentity(ctx, {
      gameId: params.gameId,
      traderIdentityId: trader.traderIdentityId,
      profitRounded,
      traderMaxActive: params.settings.traderMaxActive,
    });

    await ctx.db.insert("sim_events", {
      gameId: params.gameId,
      turnNumber: params.turnNumber,
      eventType: "bg_trader_delivered",
      actorType: "trader",
      actorId: trader._id,
      targetType: "system",
      targetId: dest._id,
      summary: `Trader delivered ${trader.cargoUnits} ${trader.commodity} to ${dest.name} (profit: ${profitRounded} cr)`,
      payload: JSON.stringify({
        traderId: trader._id,
        traderIdentityId: trader.traderIdentityId,
        originSystemId: trader.originSystemId,
        destinationSystemId: dest._id,
        cargoUnits: trader.cargoUnits,
        commodity: trader.commodity,
        boughtAtPrice: trader.boughtAtPrice,
        soldAtPrice,
        travelCost,
        creditsFromBuyer,
        profit: profitRounded,
      }),
    });
  } else {
    soldAtPrice = localCommodityUnitPrice(dest, trader.commodity);
    const revenueInt = Math.round(trader.cargoUnits * soldAtPrice);
    if (dest.ownerEmpireId !== null) {
      const empire = await ctx.db.get("emp_states", dest.ownerEmpireId);
      const local0 = dest.localTreasury ?? 0;
      let localPaid = 0;
      if (empire !== null) {
        creditsFromBuyer = Math.min(revenueInt, Math.max(0, Math.floor(empire.treasury)));
        if (creditsFromBuyer > 0) {
          await ctx.db.patch("emp_states", empire._id, {
            treasury: empire.treasury - creditsFromBuyer,
          });
        }
      }
      localPaid = localTreasuryShortfallTopUp({
        shortfall: revenueInt - creditsFromBuyer,
        localAvailable: local0,
        ownerEmpireId: dest.ownerEmpireId,
        settings: params.settings,
      });
      creditsFromBuyer += localPaid;
      if (creditsFromBuyer < revenueInt) underpaidOwnedEmpire = true;
      await ctx.db.patch("gal_systems", dest._id, {
        localTreasury: Math.max(0, local0 - localPaid) + docking,
      });
    } else {
      const local0 = dest.localTreasury ?? 0;
      creditsFromBuyer = localTreasuryShortfallTopUp({
        shortfall: revenueInt,
        localAvailable: local0,
        ownerEmpireId: dest.ownerEmpireId,
        settings: params.settings,
      });
      await ctx.db.patch("gal_systems", dest._id, {
        localTreasury: Math.max(0, local0 - creditsFromBuyer) + docking,
      });
      if (creditsFromBuyer < revenueInt) underpaidUnownedSystem = true;
    }

    const purchaseCost = trader.cargoUnits * trader.boughtAtPrice;
    const profitRounded = Math.round(creditsFromBuyer - purchaseCost - travelCost);
    const shortfall = Math.max(0, revenueInt - creditsFromBuyer);

    await ctx.db.patch("eco_bg_traders", trader._id, {
      status: "delivered",
      deliveryProfit: profitRounded,
      deliveredTurn: params.turnNumber,
      deliveryRevenue: Math.round(creditsFromBuyer),
      deliveryCost: Math.round(purchaseCost + travelCost),
      deliveryPurchaseCredits: Math.round(purchaseCost),
      deliveryShipHireTotal: shipHire,
      deliveryDockingFee: docking,
      deliveryNominalUnitPrice: soldAtPrice,
      deliveryInvoiceCredits: revenueInt,
      deliveryTreasuryShortfall: shortfall,
      deliveryBuyerUnderpaid: shortfall > 0,
    });

    await applyTraderBoycottsIfUnderpaid(ctx, {
      turnNumber: params.turnNumber,
      dest,
      underpaidOwnedEmpire,
      underpaidUnownedSystem,
    });

    await applyVoyageProfitToNpcIdentity(ctx, {
      gameId: params.gameId,
      traderIdentityId: trader.traderIdentityId,
      profitRounded,
      traderMaxActive: params.settings.traderMaxActive,
    });

    await ctx.db.insert("sim_events", {
      gameId: params.gameId,
      turnNumber: params.turnNumber,
      eventType: "bg_trader_delivered",
      actorType: "trader",
      actorId: trader._id,
      targetType: "system",
      targetId: dest._id,
      summary: `Trader delivered ${trader.cargoUnits} ${trader.commodity} to ${dest.name} (profit: ${profitRounded} cr)`,
      payload: JSON.stringify({
        traderId: trader._id,
        traderIdentityId: trader.traderIdentityId,
        originSystemId: trader.originSystemId,
        destinationSystemId: dest._id,
        cargoUnits: trader.cargoUnits,
        commodity: trader.commodity,
        boughtAtPrice: trader.boughtAtPrice,
        soldAtPrice,
        travelCost,
        creditsFromBuyer,
        profit: profitRounded,
      }),
    });
  }
}

/**
 * Delivers cargo for all traders whose ETA ≤ current turn.
 * Food to the same destination is settled in one batch so treasury pay caps are fair.
 */
async function deliverArrivedTraders(
  ctx: MutationCtx,
  params: {
    gameId: Id<"sim_games">;
    turnNumber: number;
    settings: DeliverTraderSettings;
  },
): Promise<void> {
  const candidates = await ctx.db
    .query("eco_bg_traders")
    .withIndex("by_gameId_and_status", (q) =>
      q.eq("gameId", params.gameId).eq("status", "enRoute"),
    )
    .take(128);

  const due = candidates.filter((t) => t.etaTurn <= params.turnNumber);
  due.sort((a, b) => {
    if (a.etaTurn !== b.etaTurn) return a.etaTurn - b.etaTurn;
    if (a.dispatchedTurn !== b.dispatchedTurn) return a.dispatchedTurn - b.dispatchedTurn;
    return a._id < b._id ? -1 : a._id > b._id ? 1 : 0;
  });

  const foodByDest = new Map<string, Doc<"eco_bg_traders">[]>();
  const nonFood: Doc<"eco_bg_traders">[] = [];

  for (const t of due) {
    if (t.commodity === "food") {
      const key = t.destinationSystemId as string;
      const arr = foodByDest.get(key) ?? [];
      arr.push(t);
      foodByDest.set(key, arr);
    } else {
      nonFood.push(t);
    }
  }

  for (const group of foodByDest.values()) {
    await settleFoodDeliveriesGroup(ctx, group, params);
  }

  for (const t of nonFood) {
    await deliverNonFoodTrader(ctx, t, params);
  }
}

/**
 * Rough food demand estimate from system doc.
 * Mirrors the formula used in applyTurnEconomy (simPop × FOOD_PER_POP).
 */
function estimateFoodDemand(system: Doc<"gal_systems">): number {
  const PEOPLE_PER_SIM_UNIT = 1_000_000;
  const pop = system.population ?? 0;
  return Math.max(1, (pop / PEOPLE_PER_SIM_UNIT) * FOOD_PER_POP);
}

function stableUnitRoll(seed: string): number {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 0x100000000;
}

function npcAcceptsAvailableJob(params: {
  chancePct: number;
  gameId: Id<"sim_games">;
  turnNumber: number;
  captainId: Id<"sim_trader_identities">;
  originId: Id<"gal_systems">;
  destinationId: Id<"gal_systems">;
}): boolean {
  const chancePct = Math.max(0, Math.min(100, params.chancePct));
  if (chancePct <= 0) return false;
  if (chancePct >= 100) return true;

  const roll = stableUnitRoll(
    [
      params.gameId,
      params.turnNumber,
      params.captainId,
      params.originId,
      params.destinationId,
    ].join(":"),
  );
  return roll < chancePct / 100;
}

/**
 * Greedy multi-hop food traders: each iteration picks the highest net-profit pair that
 * clears the minimum revenue÷cost ratio, until caps are hit or no viable pair remains.
 */
async function spawnNewTraders(
  ctx: MutationCtx,
  params: {
    gameId: Id<"sim_games">;
    turnNumber: number;
    traderShipCostMult: number;
    settings: Pick<
      GameSettings,
      | "foodPriceElasticityMult"
      | "starvationFoodPriceCapMult"
      | "foodStockpileMaxPerPop"
      | "foodStockpileMinPerPop"
      | "foodStressFactor"
      | "foodBasePrice"
      | "traderMinActive"
      | "traderMaxActive"
      | "traderShipHirePerTurn"
      | "traderHireChancePct"
    >;
  },
): Promise<void> {
  const maxActive = params.settings.traderMaxActive;
  const minActive = params.settings.traderMinActive;

  const activeTraders = await ctx.db
    .query("eco_bg_traders")
    .withIndex("by_gameId_and_status", (q) =>
      q.eq("gameId", params.gameId).eq("status", "enRoute"),
    )
    .take(128);

  /** Voyages still in transit after this turn's arrivals complete (ETA > now). */
  const voyagesBlockingCapacity = activeTraders.filter((t) => t.etaTurn > params.turnNumber);

  if (voyagesBlockingCapacity.length >= maxActive) return;
  // When below minimum, allow extra spawns per turn to catch up faster.
  const isBelowMin = activeTraders.length < minActive;
  // Keep this phase under Convex's 1s mutation limit. One dispatch per turn still
  // lets the market react continuously, and avoids repeated all-pairs route scans.
  const maxNewPerTurn = Math.min(
    1,
    isBelowMin ? BG_TRADER_MAX_NEW_PER_TURN * 2 : BG_TRADER_MAX_NEW_PER_TURN,
  );
  let slotsLeft = maxActive - voyagesBlockingCapacity.length;
  let newThisTurn = 0;

  const allSystems = await ctx.db
    .query("gal_systems")
    .withIndex("by_gameId", (q) => q.eq("gameId", params.gameId))
    .take(256);

  const systemById = new Map<Id<"gal_systems">, Doc<"gal_systems">>();
  for (const s of allSystems) {
    if (s.foodPrice !== undefined) {
      systemById.set(s._id, s);
    }
  }

  const empires = await ctx.db
    .query("emp_states")
    .withIndex("by_gameId", (q) => q.eq("gameId", params.gameId))
    .take(32);
  const empireById = new Map<Id<"emp_states">, Doc<"emp_states">>();
  for (const e of empires) {
    empireById.set(e._id, e);
  }

  const departuresFromSystem = new Map<Id<"gal_systems">, number>();
  const declinedCaptainIds = new Set<Id<"sim_trader_identities">>();

  const inboundByDest = new Map<Id<"gal_systems">, number>();
  for (const t of activeTraders) {
    const k = t.destinationSystemId;
    inboundByDest.set(k, (inboundByDest.get(k) ?? 0) + 1);
  }

  const links = await ctx.db
    .query("gal_links")
    .withIndex("by_gameId", (q) => q.eq("gameId", params.gameId))
    .take(2048);

  const hyperAdj = buildUndirectedHyperlaneAdjacency(links, travelTurnsFromLinkCost);

  while (newThisTurn < maxNewPerTurn && slotsLeft > 0) {
    const captainId = await pickNpcIdentityForNewVoyage(
      ctx,
      params.gameId,
      declinedCaptainIds,
    );
    if (captainId === null) {
      break;
    }

    let best: {
      origin: Doc<"gal_systems">;
      dest: Doc<"gal_systems">;
      travelTurns: number;
      profitScore: number;
      originPrice: number;
      destPrice: number;
      revenueCostRatio: number;
      cargoUnits: number;
    } | null = null;

    const destinationCandidates = Array.from(systemById.values())
      .filter((dest) => {
        const ownerId = dest.ownerEmpireId;
        if (ownerId !== null) {
          const boycottUntil = empireById.get(ownerId)?.traderBoycottUntilTurn;
          if (boycottUntil !== undefined && params.turnNumber < boycottUntil) {
            return false;
          }
        } else {
          const boycottUntil = dest.traderBoycottUntilTurn;
          if (boycottUntil !== undefined && params.turnNumber < boycottUntil) {
            return false;
          }
        }
        return (inboundByDest.get(dest._id) ?? 0) < 3;
      })
      .sort((a, b) => traderFoodSellPricePerUnit(b) - traderFoodSellPricePerUnit(a))
      .slice(0, 8);

    const originCandidates = Array.from(systemById.values())
      .flatMap((origin) => {
        const originDemand = estimateFoodDemand(origin);
        const oversupply = foodOversupplyUnits({
          stockFood: origin.stockFood ?? 0,
          foodDemand: originDemand,
          settings: params.settings,
        });
        const cargoUnits = Math.min(BG_TRADER_CARGO_SIZE, oversupply);
        return cargoUnits >= 1 ? [{ origin, cargoUnits }] : [];
      })
      .sort((a, b) => {
        const priceDelta = (a.origin.foodPrice ?? 0) - (b.origin.foodPrice ?? 0);
        return priceDelta !== 0 ? priceDelta : b.cargoUnits - a.cargoUnits;
      })
      .slice(0, 8);

    for (const dest of destinationCandidates) {
      const ownerId = dest.ownerEmpireId;
      if (ownerId !== null) {
        const boycottUntil = empireById.get(ownerId)?.traderBoycottUntilTurn;
        if (boycottUntil !== undefined && params.turnNumber < boycottUntil) {
          continue;
        }
      } else {
        const boycottUntil = dest.traderBoycottUntilTurn;
        if (boycottUntil !== undefined && params.turnNumber < boycottUntil) {
          continue;
        }
      }
      if ((inboundByDest.get(dest._id) ?? 0) >= 3) continue;

      const destPrice = traderFoodSellPricePerUnit(dest);

      for (const { origin, cargoUnits } of originCandidates) {
        if (origin._id === dest._id) continue;

        const originKey = origin._id;
        if ((departuresFromSystem.get(originKey) ?? 0) >= BG_TRADER_MAX_DEPARTURES_PER_SYSTEM) {
          continue;
        }

        const travelTurns = shortestTravelTurnsBetween(
          originKey,
          dest._id,
          hyperAdj,
        );
        if (travelTurns === null) continue;

        const originPrice = origin.foodPrice ?? 0;

        const profitability = evaluateTraderProfitability({
          cargoUnits,
          buyPricePerUnit: originPrice,
          sellPricePerUnit: destPrice,
          travelTurns,
          shipCostMult: params.traderShipCostMult,
          shipHirePerTurn: params.settings.traderShipHirePerTurn,
        });

        if (!profitability.passesMinimum) continue;

        const profitScore = profitability.expectedRevenue - profitability.totalCost;

        let beatsBest = best === null;
        if (!beatsBest && best !== null) {
          if (profitScore > best.profitScore) beatsBest = true;
          else if (profitScore === best.profitScore) {
            if (profitability.ratio > best.revenueCostRatio) beatsBest = true;
            else if (
              profitability.ratio === best.revenueCostRatio &&
              travelTurns < best.travelTurns
            ) {
              beatsBest = true;
            }
          }
        }

        if (beatsBest) {
          best = {
            origin,
            dest,
            travelTurns,
            profitScore,
            originPrice,
            destPrice,
            revenueCostRatio: profitability.ratio,
            cargoUnits,
          };
        }
      }
    }

    if (best === null) break;

    const origin = best.origin;
    const dest = best.dest;
    if (
      !npcAcceptsAvailableJob({
        chancePct: params.settings.traderHireChancePct,
        gameId: params.gameId,
        turnNumber: params.turnNumber,
        captainId,
        originId: origin._id,
        destinationId: dest._id,
      })
    ) {
      declinedCaptainIds.add(captainId);
      continue;
    }

    const originStock = origin.stockFood ?? 0;
    const originPriceAtBuy = origin.foodPrice ?? 0;
    const cargoUnits = best.cargoUnits;

    const newOriginStock = originStock - cargoUnits;
    const originDemand = estimateFoodDemand(origin);
    const newOriginPrice = computeSystemFoodPrice({
      stockFood: newOriginStock,
      foodDemand: originDemand,
      settings: params.settings,
    });
    // Origin systems raise local money by selling oversupply to passing traders.
    const purchaseCredits = Math.round(cargoUnits * originPriceAtBuy);

    await ctx.db.patch("gal_systems", origin._id, {
      stockFood: newOriginStock,
      foodPrice: newOriginPrice,
      ...(purchaseCredits > 0
        ? { localTreasury: Math.max(0, (origin.localTreasury ?? 0) + purchaseCredits) }
        : {}),
    });

    systemById.set(origin._id, {
      ...origin,
      stockFood: newOriginStock,
      foodPrice: newOriginPrice,
      localTreasury:
        purchaseCredits > 0
          ? Math.max(0, (origin.localTreasury ?? 0) + purchaseCredits)
          : origin.localTreasury,
    });

    const etaTurn = params.turnNumber + best.travelTurns;
    const shipHirePerTurn = params.settings.traderShipHirePerTurn;
    await ctx.db.insert("eco_bg_traders", {
      gameId: params.gameId,
      traderIdentityId: captainId,
      originSystemId: origin._id,
      destinationSystemId: dest._id,
      commodity: "food",
      cargoUnits,
      boughtAtPrice: originPriceAtBuy,
      travelTurns: best.travelTurns,
      etaTurn,
      dispatchedTurn: params.turnNumber,
      shipHireCostPerTurn: shipHirePerTurn,
      status: "enRoute",
    });

    await ctx.db.insert("sim_events", {
      gameId: params.gameId,
      turnNumber: params.turnNumber,
      eventType: "bg_trader_dispatched",
      actorType: "trader",
      actorId: origin._id,
      targetType: "system",
      targetId: dest._id,
      summary: `Trader dispatched: ${cargoUnits} food from ${origin.name} → ${dest.name} (ETA turn ${etaTurn}, ${best.travelTurns} hop-turns, revenue ${best.revenueCostRatio.toFixed(2)}× cost)`,
      payload: JSON.stringify({
        traderIdentityId: captainId,
        originSystemId: origin._id,
        destinationSystemId: dest._id,
        cargoUnits,
        originPrice: originPriceAtBuy,
        destPrice: best.destPrice,
        travelTurns: best.travelTurns,
        etaTurn,
        revenueCostRatio: best.revenueCostRatio,
        shipHireCost: shipHirePerTurn * best.travelTurns,
        traderHireChancePct: params.settings.traderHireChancePct,
      }),
    });

    departuresFromSystem.set(
      origin._id,
      (departuresFromSystem.get(origin._id) ?? 0) + 1,
    );
    inboundByDest.set(dest._id, (inboundByDest.get(dest._id) ?? 0) + 1);
    newThisTurn++;
    slotsLeft--;
  }
}

/**
 * Main entry point — called once per turn after applyTurnEconomy has run
 * (so per-system foodPrice values are already up to date).
 *
 * Spawn runs **before** delivery so route selection sees economy scarcity (`foodPrice` /
 * stock before inbound traders unload). Deliver-first inverted prices for distressed worlds:
 * they received cargo earlier in the same phase and briefly looked cheaper than stable worlds,
 * steering NPCs toward worse destinations.
 *
 * @param traderShipCostMult God-mode multiplier for ship-hire costs.
 *   Values > 1 make trading less profitable (fewer traders spawn);
 *   values < 1 make trading cheaper (more traders spawn).
 */
export async function applyBackgroundTrade(
  ctx: MutationCtx,
  params: { gameId: Id<"sim_games">; turnNumber: number; traderShipCostMult?: number },
): Promise<void> {
  await setupBackgroundTradeNpcs(ctx, params);
  await spawnBackgroundTrade(ctx, params);
  await deliverBackgroundTrade(ctx, params);
}

export async function setupBackgroundTradeNpcs(
  ctx: MutationCtx,
  params: { gameId: Id<"sim_games"> },
): Promise<void> {
  const settings = await loadGameSettings(ctx, params.gameId);
  await ensureNpcTraderIdentitiesForGame(ctx, params.gameId);
  await refillActiveNpcIdentities(ctx, {
    gameId: params.gameId,
    traderMaxActive: settings.traderMaxActive,
  });
}

export async function deliverBackgroundTrade(
  ctx: MutationCtx,
  params: { gameId: Id<"sim_games">; turnNumber: number },
): Promise<void> {
  const settings = await loadGameSettings(ctx, params.gameId);
  await deliverArrivedTraders(ctx, { ...params, settings });
}

export async function spawnBackgroundTrade(
  ctx: MutationCtx,
  params: { gameId: Id<"sim_games">; turnNumber: number; traderShipCostMult?: number },
): Promise<void> {
  const settings = await loadGameSettings(ctx, params.gameId);
  await spawnNewTraders(ctx, {
    ...params,
    traderShipCostMult: params.traderShipCostMult ?? settings.traderShipCostMult,
    settings,
  });
}

export const spawnBackgroundTradeForTurn = internalMutation({
  args: {
    gameId: v.id("sim_games"),
    turnNumber: v.number(),
    traderShipCostMult: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await spawnBackgroundTrade(ctx, args);
    return null;
  },
});

