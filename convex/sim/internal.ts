import { internalMutation } from "../_generated/server";
import { v } from "convex/values";
import type { Doc } from "../_generated/dataModel";
import { findLinkBetweenSystems } from "../gal/linkUtils";

function travelTurns(link: Doc<"gal_links">): number {
  return Math.max(1, Math.ceil(link.travelCost / 6));
}

export const appendEvent = internalMutation({
  args: {
    gameId: v.id("sim_games"),
    turnNumber: v.number(),
    eventType: v.string(),
    actorType: v.string(),
    actorId: v.string(),
    targetType: v.union(v.string(), v.null()),
    targetId: v.union(v.string(), v.null()),
    summary: v.string(),
    payload: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("sim_events", args);
  },
});

export const resolveTurn = internalMutation({
  args: { gameId: v.id("sim_games") },
  handler: async (ctx, args): Promise<{ resolvedTurn: number; nextTurn: number }> => {
    const game = await ctx.db.get("sim_games", args.gameId);
    if (game === null) {
      throw new Error("Game not found.");
    }
    if (game.status !== "running") {
      throw new Error("Game is not running.");
    }

    const t = game.currentTurn;

    const fleets = await ctx.db
      .query("flt_fleets")
      .withIndex("by_gameId", (q) => q.eq("gameId", args.gameId))
      .take(64);

    for (const fleet of fleets) {
      if (
        fleet.status === "enRoute" &&
        fleet.etaTurn === t &&
        fleet.destinationSystemId !== null
      ) {
        const destId = fleet.destinationSystemId;
        await ctx.db.patch("flt_fleets", fleet._id, {
          originSystemId: destId,
          destinationSystemId: null,
          etaTurn: null,
          status: "idle",
        });
        await ctx.db.insert("sim_events", {
          gameId: args.gameId,
          turnNumber: t,
          eventType: "fleet_arrived",
          actorType: "fleet",
          actorId: fleet._id,
          targetType: "system",
          targetId: destId,
          summary: `${fleet.name} arrived`,
          payload: JSON.stringify({ fleetId: fleet._id, systemId: destId }),
        });
      }
    }

    const orders = await ctx.db
      .query("flt_orders")
      .withIndex("by_gameId_and_turnNumber", (q) =>
        q.eq("gameId", args.gameId).eq("turnNumber", t),
      )
      .take(64);

    for (const order of orders) {
      const fleet = await ctx.db.get("flt_fleets", order.fleetId);
      if (fleet === null || fleet.gameId !== args.gameId) {
        await ctx.db.delete("flt_orders", order._id);
        continue;
      }

      if (order.orderType === "move" && order.targetSystemId !== null) {
        const link = await findLinkBetweenSystems(
          ctx,
          args.gameId,
          fleet.originSystemId,
          order.targetSystemId,
        );

        if (
          link !== null &&
          fleet.status === "idle" &&
          fleet.originSystemId !== order.targetSystemId
        ) {
          const turns = travelTurns(link);
          const etaTurn = t + turns;
          await ctx.db.patch("flt_fleets", fleet._id, {
            destinationSystemId: order.targetSystemId,
            etaTurn,
            status: "enRoute",
          });
          await ctx.db.insert("sim_events", {
            gameId: args.gameId,
            turnNumber: t,
            eventType: "fleet_dispatched",
            actorType: "fleet",
            actorId: fleet._id,
            targetType: "system",
            targetId: order.targetSystemId,
            summary: `${fleet.name} en route (ETA turn ${etaTurn})`,
            payload: JSON.stringify({
              fleetId: fleet._id,
              targetSystemId: order.targetSystemId,
              etaTurn,
            }),
          });
        }
      }

      await ctx.db.delete("flt_orders", order._id);
    }

    const empires = await ctx.db
      .query("emp_states")
      .withIndex("by_gameId", (q) => q.eq("gameId", args.gameId))
      .take(32);

    const taxPerEmpire = 50;
    for (const empire of empires) {
      await ctx.db.patch("emp_states", empire._id, {
        treasury: empire.treasury + taxPerEmpire,
      });
    }

    await ctx.db.insert("eco_market_snapshots", {
      gameId: args.gameId,
      turnNumber: t,
      commodity: "food",
      unitPrice: 10 + t * 0.25,
      volume: 120,
    });
    await ctx.db.insert("eco_market_snapshots", {
      gameId: args.gameId,
      turnNumber: t,
      commodity: "ore",
      unitPrice: 22 + t * 0.4,
      volume: 80,
    });

    const activeTurn = await ctx.db
      .query("sim_turns")
      .withIndex("by_gameId_and_turnNumber", (q) =>
        q.eq("gameId", args.gameId).eq("turnNumber", t),
      )
      .unique();

    if (activeTurn !== null) {
      await ctx.db.patch("sim_turns", activeTurn._id, {
        resolvedAt: Date.now(),
        state: "resolved",
      });
    }

    const nextTurn = t + 1;
    await ctx.db.patch("sim_games", args.gameId, { currentTurn: nextTurn });

    await ctx.db.insert("sim_turns", {
      gameId: args.gameId,
      turnNumber: nextTurn,
      startedAt: Date.now(),
      resolvedAt: null,
      state: "open",
    });

    await ctx.db.insert("sim_events", {
      gameId: args.gameId,
      turnNumber: t,
      eventType: "turn_resolved",
      actorType: "sim",
      actorId: args.gameId,
      targetType: null,
      targetId: null,
      summary: `Turn ${t} resolved → turn ${nextTurn}`,
      payload: JSON.stringify({ resolvedTurn: t, nextTurn }),
    });

    return { resolvedTurn: t, nextTurn };
  },
});
