import { query } from "../_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";

export const listFleetsForGame = query({
  args: { gameId: v.id("sim_games"), limit: v.number() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("flt_fleets")
      .withIndex("by_gameId", (q) => q.eq("gameId", args.gameId))
      .take(args.limit);
  },
});

export const listPendingMoveOrdersForTurn = query({
  args: {
    gameId: v.id("sim_games"),
    turnNumber: v.number(),
    limit: v.number(),
  },
  handler: async (ctx, args) => {
    const orders = await ctx.db
      .query("flt_orders")
      .withIndex("by_gameId_and_turnNumber", (q) =>
        q.eq("gameId", args.gameId).eq("turnNumber", args.turnNumber),
      )
      .take(args.limit);

    const result: Array<{
      orderId: Id<"flt_orders">;
      fleetId: Id<"flt_fleets">;
      fleetName: string;
      originSystemId: Id<"gal_systems">;
      targetSystemId: Id<"gal_systems">;
      shipCount: number;
    }> = [];
    for (const order of orders) {
      if (order.orderType !== "move" || order.targetSystemId === null) continue;
      const fleet: Doc<"flt_fleets"> | null = await ctx.db.get(
        "flt_fleets",
        order.fleetId,
      );
      if (fleet === null) continue;
      result.push({
        orderId: order._id,
        fleetId: order.fleetId,
        fleetName: fleet.name,
        originSystemId: fleet.originSystemId,
        targetSystemId: order.targetSystemId,
        shipCount:
          order.shipCount === undefined ? fleet.strength : order.shipCount,
      });
    }
    return result;
  },
});

/** Standing garrison→neighbor routes for the caller's empire in this game (admin: same, no cross-empire listing). */
export const listMyGarrisonRoutes = query({
  args: { gameId: v.id("sim_games") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      return [];
    }

    const binding = await ctx.db
      .query("usr_game_roles")
      .withIndex("by_gameId_and_userId", (q) =>
        q.eq("gameId", args.gameId).eq("userId", userId),
      )
      .unique();

    if (binding === null || !binding.isActive || binding.role === "observer") {
      return [];
    }

    if (binding.role === "admin") {
      return await ctx.db
        .query("flt_garrison_routes")
        .withIndex("by_gameId", (q) => q.eq("gameId", args.gameId))
        .take(128);
    }

    const empireId = binding.empireId;
    if (empireId === null) {
      return [];
    }

    return await ctx.db
      .query("flt_garrison_routes")
      .withIndex("by_gameId_and_empireId", (q) =>
        q.eq("gameId", args.gameId).eq("empireId", empireId),
      )
      .take(64);
  },
});
