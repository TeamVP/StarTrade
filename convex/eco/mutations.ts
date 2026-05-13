import { mutation } from "../_generated/server";
import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { assertGameAdmin, assertMayAdjustEmpireEconomy } from "../sim/helpers";
import { travelTurnsFromLinkCost } from "../sim/fleetDispatch";
import {
  BG_TRADER_MIN_REVENUE_TO_COST_RATIO,
  BG_TRADER_SHIP_HIRE_PER_TURN,
  FOOD_PER_POP,
  MAX_EMPIRE_TAX_RATE,
  NPC_TRADER_STARTING_TREASURY,
} from "../sim/economy/constants";
import { computeSystemFoodPrice } from "../sim/economy/foodPricing";
import { DEFAULT_GAME_SETTINGS, loadGameSettings } from "../sim/economy/gameSettings";
import { populationToSimUnits } from "../sim/economy/population";
import {
  evaluateTraderProfitability,
  localCommodityUnitPrice,
} from "./traderEconomics";
import {
  buildUndirectedHyperlaneAdjacency,
  shortestTravelTurnsBetween,
} from "../gal/hyperlaneGraph";

/**
 * Admin action: manually inject a background trader on any hyperspace-connected route
 * (multi-hop allowed). Weak profitability and missing routes return `{ ok: false, ... }`
 * instead of throwing so the UI can show inline feedback.
 *
 * For food and weapons, cargo is removed from the origin system stockpile and the seller
 * (owning empire treasury, or `localTreasury` when unaligned) receives the purchase credits,
 * matching automated background trade settlement. Heavy metals still spawn without an origin
 * stock ledger until per-system inventory exists.
 *
 * Requires the caller to be a game admin.
 */
export const spawnTrader = mutation({
  args: {
    gameId: v.id("sim_games"),
    originSystemId: v.id("gal_systems"),
    destinationSystemId: v.id("gal_systems"),
    commodity: v.string(),
    cargoUnits: v.number(),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Authentication required.");
    await assertGameAdmin(ctx, args.gameId, userId);

    if (args.originSystemId === args.destinationSystemId) {
      throw new Error("Origin and destination must be different systems.");
    }
    if (args.cargoUnits < 1) {
      throw new Error("Cargo units must be at least 1.");
    }
    if (!["food", "weapons", "heavy_metals"].includes(args.commodity)) {
      throw new Error("Invalid commodity. Must be: food, weapons, or heavy_metals.");
    }

    const game = await ctx.db.get("sim_games", args.gameId);
    if (game === null) throw new Error("Game not found.");

    const origin = await ctx.db.get("gal_systems", args.originSystemId);
    const dest = await ctx.db.get("gal_systems", args.destinationSystemId);
    if (origin === null) throw new Error("Origin system not found.");
    if (dest === null) throw new Error("Destination system not found.");

    const links = await ctx.db
      .query("gal_links")
      .withIndex("by_gameId", (q) => q.eq("gameId", args.gameId))
      .take(2048);

    const adjacency = buildUndirectedHyperlaneAdjacency(links, travelTurnsFromLinkCost);
    const travelTurns = shortestTravelTurnsBetween(
      args.originSystemId,
      args.destinationSystemId,
      adjacency,
    );

    if (travelTurns === null) {
      return {
        ok: false as const,
        code: "no_route" as const,
        message: `No hyperspace route connects ${origin.name} to ${dest.name}. Check that both systems are linked through the lane network.`,
      };
    }

    const buyPrice = localCommodityUnitPrice(origin, args.commodity);
    const sellPrice = localCommodityUnitPrice(dest, args.commodity);

    const profitability = evaluateTraderProfitability({
      cargoUnits: args.cargoUnits,
      buyPricePerUnit: buyPrice,
      sellPricePerUnit: sellPrice,
      travelTurns,
    });

    if (!profitability.passesMinimum) {
      return {
        ok: false as const,
        code: "profitability" as const,
        message: `Expected revenue (${Math.round(profitability.expectedRevenue)} cr) must be at least ${BG_TRADER_MIN_REVENUE_TO_COST_RATIO}× full voyage cost (${Math.round(profitability.totalCost)} cr). Current ratio ≈ ${profitability.ratio.toFixed(2)}× — trader refuses this run.`,
        profitabilityRatio: profitability.ratio,
        expectedRevenue: profitability.expectedRevenue,
        totalCost: profitability.totalCost,
      };
    }

    const purchaseCredits = Math.round(args.cargoUnits * buyPrice);

    if (args.commodity === "food") {
      const stock0 = Math.max(0, origin.stockFood ?? 0);
      if (stock0 < args.cargoUnits) {
        return {
          ok: false as const,
          code: "insufficient_origin_stock" as const,
          message: `${origin.name} only has ${Math.floor(stock0)} food in stock; cannot load ${args.cargoUnits} units.`,
        };
      }
      const settings = await loadGameSettings(ctx, args.gameId);
      const foodDemand = Math.max(
        1,
        populationToSimUnits(origin.population ?? 0) * FOOD_PER_POP,
      );
      const newStock = stock0 - args.cargoUnits;
      const newFoodPrice = computeSystemFoodPrice({
        stockFood: newStock,
        foodDemand,
        settings,
      });
      if (origin.ownerEmpireId !== null) {
        const empire = await ctx.db.get("emp_states", origin.ownerEmpireId);
        if (empire !== null && purchaseCredits > 0) {
          await ctx.db.patch("emp_states", empire._id, {
            treasury: empire.treasury + purchaseCredits,
          });
        }
        await ctx.db.patch("gal_systems", origin._id, {
          stockFood: newStock,
          foodPrice: newFoodPrice,
        });
      } else {
        await ctx.db.patch("gal_systems", origin._id, {
          stockFood: newStock,
          foodPrice: newFoodPrice,
          localTreasury: Math.max(0, (origin.localTreasury ?? 0) + purchaseCredits),
        });
      }
    } else if (args.commodity === "weapons") {
      const stock0 = Math.max(0, origin.stockWeapons ?? 0);
      if (stock0 < args.cargoUnits) {
        return {
          ok: false as const,
          code: "insufficient_origin_stock" as const,
          message: `${origin.name} only has ${Math.floor(stock0)} weapons in stock; cannot load ${args.cargoUnits} units.`,
        };
      }
      const newStock = stock0 - args.cargoUnits;
      if (origin.ownerEmpireId !== null) {
        const empire = await ctx.db.get("emp_states", origin.ownerEmpireId);
        if (empire !== null && purchaseCredits > 0) {
          await ctx.db.patch("emp_states", empire._id, {
            treasury: empire.treasury + purchaseCredits,
          });
        }
        await ctx.db.patch("gal_systems", origin._id, { stockWeapons: newStock });
      } else {
        await ctx.db.patch("gal_systems", origin._id, {
          stockWeapons: newStock,
          localTreasury: Math.max(0, (origin.localTreasury ?? 0) + purchaseCredits),
        });
      }
    }

    const currentTurn = game.currentTurn;
    const etaTurn = currentTurn + travelTurns;

    const boughtAtPrice = buyPrice;

    const traderId = await ctx.db.insert("eco_bg_traders", {
      gameId: args.gameId,
      originSystemId: args.originSystemId,
      destinationSystemId: args.destinationSystemId,
      commodity: args.commodity,
      cargoUnits: args.cargoUnits,
      boughtAtPrice,
      travelTurns,
      etaTurn,
      dispatchedTurn: currentTurn,
      shipHireCostPerTurn: BG_TRADER_SHIP_HIRE_PER_TURN,
      status: "enRoute",
    });

    await ctx.db.insert("sim_events", {
      gameId: args.gameId,
      turnNumber: currentTurn,
      eventType: "bg_trader_dispatched",
      actorType: "admin",
      actorId: userId,
      targetType: "system",
      targetId: args.destinationSystemId,
      summary: `Admin spawned trader: ${args.cargoUnits} ${args.commodity} from ${origin.name} → ${dest.name} (ETA turn ${etaTurn})`,
      payload: JSON.stringify({
        traderId,
        originSystemId: args.originSystemId,
        destinationSystemId: args.destinationSystemId,
        cargoUnits: args.cargoUnits,
        commodity: args.commodity,
        travelTurns,
        etaTurn,
        adminSpawned: true,
      }),
    });

    return {
      ok: true as const,
      traderId,
      etaTurn,
      travelTurns,
      profitabilityRatio: profitability.ratio,
      profitabilityWarning: profitability.needsWeakProfitWarning
        ? `Weak profitability: expected revenue is ${profitability.ratio.toFixed(2)}× voyage cost (strong runs aim for ≥ 2.2×).`
        : null,
    };
  },
});

/**
 * Game admin: credit an NPC merchant’s treasury (default bump matches starting capital).
 */
export const addNpcTraderTreasuryFunds = mutation({
  args: {
    gameId: v.id("sim_games"),
    traderIdentityId: v.id("sim_trader_identities"),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Authentication required.");
    await assertGameAdmin(ctx, args.gameId, userId);

    const row = await ctx.db.get("sim_trader_identities", args.traderIdentityId);
    if (row === null) {
      throw new Error("Merchant not found.");
    }
    if (row.gameId !== args.gameId) {
      throw new Error("This merchant does not belong to the selected game.");
    }
    if (row.kind !== "npc") {
      throw new Error("Only NPC merchants can receive funds through this action.");
    }

    const next = row.treasury + NPC_TRADER_STARTING_TREASURY;
    if (row.state === "bankrupt") {
      await ctx.db.patch("sim_trader_identities", row._id, {
        treasury: next,
        state: "active",
      });
    } else {
      await ctx.db.patch("sim_trader_identities", row._id, { treasury: next });
    }
    return { newTreasury: next, state: row.state === "bankrupt" ? ("active" as const) : row.state };
  },
});

/**
 * Game admin: set the chance that automated NPC merchants accept a viable job.
 */
export const updateNpcTraderHireChancePct = mutation({
  args: {
    gameId: v.id("sim_games"),
    traderHireChancePct: v.number(),
  },
  returns: v.object({
    traderHireChancePct: v.number(),
  }),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Authentication required.");
    await assertGameAdmin(ctx, args.gameId, userId);

    const traderHireChancePct = Math.max(
      0,
      Math.min(100, Math.round(args.traderHireChancePct)),
    );

    const existing = await ctx.db
      .query("sim_game_settings")
      .withIndex("by_gameId", (q) => q.eq("gameId", args.gameId))
      .unique();

    if (existing === null) {
      await ctx.db.insert("sim_game_settings", {
        ...DEFAULT_GAME_SETTINGS,
        gameId: args.gameId,
        traderHireChancePct,
      });
    } else {
      await ctx.db.patch("sim_game_settings", existing._id, { traderHireChancePct });
    }

    return { traderHireChancePct };
  },
});

/**
 * Set empire-wide tax (0–30% of economic activity). Scales treasury pop-tax and dampens
 * local food/ships/research output on the next processed turn. Admins may set any empire;
 * empire-role players may only set their own `empireId`.
 */
export const setEmpireTaxRate = mutation({
  args: {
    gameId: v.id("sim_games"),
    empireId: v.id("emp_states"),
    taxPercent: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Authentication required.");

    const empire = await assertMayAdjustEmpireEconomy(ctx, {
      gameId: args.gameId,
      userId,
      empireId: args.empireId,
    });

    if (empire.isCollapsed) {
      throw new Error("Cannot change tax rate for a collapsed empire.");
    }

    const pct = Math.round(args.taxPercent);
    const clampedPct = Math.max(0, Math.min(30, pct));
    const empireTaxRate = Math.max(0, Math.min(MAX_EMPIRE_TAX_RATE, clampedPct / 100));

    await ctx.db.patch("emp_states", args.empireId, {
      empireTaxRate,
    });
    return null;
  },
});
