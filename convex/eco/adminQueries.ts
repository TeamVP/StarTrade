import { query } from "../_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";

/**
 * Full-game economy snapshot for map admins: empires, systems with holdings + idle fleet totals,
 * latest turn market prices.
 */
export const adminEconomySnapshot = query({
  args: { gameId: v.id("sim_games") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      return { kind: "unauthenticated" as const };
    }

    const binding = await ctx.db
      .query("usr_game_roles")
      .withIndex("by_gameId_and_userId", (q) =>
        q.eq("gameId", args.gameId).eq("userId", userId),
      )
      .unique();

    if (binding === null || !binding.isActive || binding.role !== "admin") {
      return { kind: "forbidden" as const };
    }

    const game = await ctx.db.get("sim_games", args.gameId);
    if (game === null) {
      return { kind: "not_found" as const };
    }

    const empires = await ctx.db
      .query("emp_states")
      .withIndex("by_gameId", (q) => q.eq("gameId", args.gameId))
      .take(64);

    const systemsRaw = await ctx.db
      .query("gal_systems")
      .withIndex("by_gameId", (q) => q.eq("gameId", args.gameId))
      .take(256);

    const holdings = await ctx.db
      .query("emp_system_holdings")
      .withIndex("by_gameId", (q) => q.eq("gameId", args.gameId))
      .take(512);

    const holdingBySystemId = new Map<Id<"gal_systems">, Doc<"emp_system_holdings">>();
    for (const h of holdings) {
      holdingBySystemId.set(h.systemId, h);
    }

    const fleets = await ctx.db
      .query("flt_fleets")
      .withIndex("by_gameId", (q) => q.eq("gameId", args.gameId))
      .take(256);

    const idleStrengthBySystem = new Map<Id<"gal_systems">, number>();
    for (const fleet of fleets) {
      if (fleet.status !== "idle") continue;
      idleStrengthBySystem.set(
        fleet.originSystemId,
        (idleStrengthBySystem.get(fleet.originSystemId) ?? 0) + fleet.strength,
      );
    }

    const systems = systemsRaw.map((system) => ({
      ...system,
      idleFleetStrength: idleStrengthBySystem.get(system._id) ?? 0,
      holding: holdingBySystemId.get(system._id) ?? null,
    }));

    const marketSnapshots = await ctx.db
      .query("eco_market_snapshots")
      .withIndex("by_gameId_and_turnNumber", (q) =>
        q.eq("gameId", args.gameId).eq("turnNumber", game.currentTurn),
      )
      .take(32);

    return {
      kind: "ok" as const,
      game: {
        _id: game._id,
        name: game.name,
        status: game.status,
        currentTurn: game.currentTurn,
        mapKey: game.mapKey,
      },
      empires,
      systems,
      marketSnapshots: marketSnapshots.map((row) => ({
        commodity: row.commodity,
        unitPrice: row.unitPrice,
        volume: row.volume,
      })),
    };
  },
});
