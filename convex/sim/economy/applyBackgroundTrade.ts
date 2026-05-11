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
 *  - Delivering to dest increases its stockFood → price falls (shortage normalised).
 */

import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx } from "../../_generated/server";
import type { GameSettings } from "./gameSettings";
import { loadGameSettings } from "./gameSettings";
import { computeSystemFoodPrice, foodOversupplyUnits } from "./foodPricing";
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

/**
 * Delivers cargo for all traders whose ETA ≤ current turn.
 * Updates destination system stockFood and emits a sim_event.
 */
async function deliverArrivedTraders(
  ctx: MutationCtx,
  params: {
    gameId: Id<"sim_games">;
    turnNumber: number;
    settings: Pick<
      GameSettings,
      | "foodPriceElasticityMult"
      | "starvationFoodPriceCapMult"
      | "foodStockpileMaxPerPop"
      | "foodStockpileMinPerPop"
      | "foodStressFactor"
      | "foodBasePrice"
      | "traderDockingCost"
      | "traderMaxActive"
    >;
  },
): Promise<void> {
  // Fetch traders arriving this turn or earlier that are still enRoute.
  const candidates = await ctx.db
    .query("eco_bg_traders")
    .withIndex("by_gameId_and_status", (q) =>
      q.eq("gameId", params.gameId).eq("status", "enRoute"),
    )
    .take(64);

  for (const trader of candidates) {
    if (trader.etaTurn > params.turnNumber) continue;

    const dest = await ctx.db.get("gal_systems", trader.destinationSystemId);
    if (dest === null) {
      // Destination gone — cancel silently.
      await ctx.db.patch("eco_bg_traders", trader._id, { status: "cancelled" });
      continue;
    }

    const travelCost =
      trader.shipHireCostPerTurn * trader.travelTurns + params.settings.traderDockingCost;

    let soldAtPrice: number;

    if (trader.commodity === "food") {
      const newStock = Math.max(0, (dest.stockFood ?? 0) + trader.cargoUnits);
      const foodDemand = estimateFoodDemand(dest);
      const clearingPrice = computeSystemFoodPrice({
        stockFood: newStock,
        foodDemand,
        settings: params.settings,
      });
      const subsidyPerUnit = Math.max(0, dest.foodImportSubsidyPerUnit ?? 0);
      const desiredSubsidyTotal = trader.cargoUnits * subsidyPerUnit;
      let paidSubsidyTotal = 0;
      if (desiredSubsidyTotal > 0 && dest.ownerEmpireId !== null) {
        const empire = await ctx.db.get("emp_states", dest.ownerEmpireId);
        if (empire !== null) {
          paidSubsidyTotal = Math.min(desiredSubsidyTotal, Math.max(0, empire.treasury));
          if (paidSubsidyTotal > 0) {
            await ctx.db.patch("emp_states", empire._id, {
              treasury: empire.treasury - paidSubsidyTotal,
            });
          }
        }
      } else if (desiredSubsidyTotal > 0) {
        const local = dest.localTreasury ?? 0;
        paidSubsidyTotal = Math.min(desiredSubsidyTotal, Math.max(0, local));
      }
      const perUnitBonus =
        trader.cargoUnits > 0 ? paidSubsidyTotal / trader.cargoUnits : 0;
      soldAtPrice = clearingPrice + perUnitBonus;

      await ctx.db.patch("gal_systems", dest._id, {
        stockFood: newStock,
        foodPrice: clearingPrice,
        ...(desiredSubsidyTotal > 0 &&
        dest.ownerEmpireId === null &&
        paidSubsidyTotal > 0
          ? {
              localTreasury: Math.max(0, (dest.localTreasury ?? 0) - paidSubsidyTotal),
            }
          : {}),
      });
    } else if (trader.commodity === "weapons") {
      const newWeapons = Math.max(0, (dest.stockWeapons ?? 0) + trader.cargoUnits);
      await ctx.db.patch("gal_systems", dest._id, {
        stockWeapons: newWeapons,
      });
      const destAfterWeapons: Doc<"gal_systems"> = {
        ...dest,
        stockWeapons: newWeapons,
      };
      soldAtPrice = localCommodityUnitPrice(destAfterWeapons, "weapons");
    } else {
      soldAtPrice = localCommodityUnitPrice(dest, trader.commodity);
    }

    await ctx.db.patch("eco_bg_traders", trader._id, { status: "delivered" });

    const revenue = trader.cargoUnits * soldAtPrice;
    const profit = revenue - trader.cargoUnits * trader.boughtAtPrice - travelCost;

    await applyVoyageProfitToNpcIdentity(ctx, {
      gameId: params.gameId,
      traderIdentityId: trader.traderIdentityId,
      profitRounded: Math.round(profit),
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
      summary: `Trader delivered ${trader.cargoUnits} ${trader.commodity} to ${dest.name} (profit: ${Math.round(profit)} cr)`,
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
        profit: Math.round(profit),
      }),
    });
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
    .take(maxActive + 1);

  if (activeTraders.length >= maxActive) return;
  // When below minimum, allow extra spawns per turn to catch up faster.
  const isBelowMin = activeTraders.length < minActive;
  const maxNewPerTurn = isBelowMin ? BG_TRADER_MAX_NEW_PER_TURN * 2 : BG_TRADER_MAX_NEW_PER_TURN;
  let slotsLeft = maxActive - activeTraders.length;
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

  const departuresFromSystem = new Map<string, number>();

  const inboundByDest = new Map<string, number>();
  for (const t of activeTraders) {
    const k = t.destinationSystemId as string;
    inboundByDest.set(k, (inboundByDest.get(k) ?? 0) + 1);
  }

  const links = await ctx.db
    .query("gal_links")
    .withIndex("by_gameId", (q) => q.eq("gameId", params.gameId))
    .take(2048);

  const hyperAdj = buildUndirectedHyperlaneAdjacency(links, travelTurnsFromLinkCost);

  while (newThisTurn < maxNewPerTurn && slotsLeft > 0) {
    const captainId = await pickNpcIdentityForNewVoyage(ctx, params.gameId);
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

    for (const dest of systemById.values()) {
      if ((inboundByDest.get(dest._id as string) ?? 0) >= 3) continue;

      const destPrice = traderFoodSellPricePerUnit(dest);

      for (const origin of systemById.values()) {
        if (origin._id === dest._id) continue;

        const originKey = origin._id as string;
        if ((departuresFromSystem.get(originKey) ?? 0) >= BG_TRADER_MAX_DEPARTURES_PER_SYSTEM) {
          continue;
        }

        const originDemand = estimateFoodDemand(origin);
        const oversupply = foodOversupplyUnits({
          stockFood: origin.stockFood ?? 0,
          foodDemand: originDemand,
          settings: params.settings,
        });
        const cargoUnits = Math.min(BG_TRADER_CARGO_SIZE, oversupply);
        if (cargoUnits < 1) continue;

        const travelTurns = shortestTravelTurnsBetween(
          originKey,
          dest._id as string,
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

    await ctx.db.patch("gal_systems", origin._id, {
      stockFood: newOriginStock,
      foodPrice: newOriginPrice,
    });

    systemById.set(origin._id, {
      ...origin,
      stockFood: newOriginStock,
      foodPrice: newOriginPrice,
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
      }),
    });

    departuresFromSystem.set(
      origin._id as string,
      (departuresFromSystem.get(origin._id as string) ?? 0) + 1,
    );
    inboundByDest.set(dest._id as string, (inboundByDest.get(dest._id as string) ?? 0) + 1);
    newThisTurn++;
    slotsLeft--;
  }
}

/**
 * Main entry point — called once per turn after applyTurnEconomy has run
 * (so per-system foodPrice values are already up to date).
 *
 * @param traderShipCostMult God-mode multiplier for ship-hire costs.
 *   Values > 1 make trading less profitable (fewer traders spawn);
 *   values < 1 make trading cheaper (more traders spawn).
 */
export async function applyBackgroundTrade(
  ctx: MutationCtx,
  params: { gameId: Id<"sim_games">; turnNumber: number; traderShipCostMult?: number },
): Promise<void> {
  const settings = await loadGameSettings(ctx, params.gameId);
  await ensureNpcTraderIdentitiesForGame(ctx, params.gameId);
  await refillActiveNpcIdentities(ctx, {
    gameId: params.gameId,
    traderMaxActive: settings.traderMaxActive,
  });
  await deliverArrivedTraders(ctx, { ...params, settings });
  await spawnNewTraders(ctx, {
    ...params,
    traderShipCostMult: params.traderShipCostMult ?? settings.traderShipCostMult,
    settings,
  });
}

