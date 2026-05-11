import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { dispatchMoveFromFleet } from "./fleetDispatch";

export async function applyFleetMoveOrders(
  ctx: MutationCtx,
  params: {
    gameId: Id<"sim_games">;
    turnNumber: number;
    orders: Doc<"flt_orders">[];
  },
): Promise<void> {
  for (const order of params.orders) {
    if (order.orderType === "retreat") {
      continue;
    }
    if (order.orderType !== "move") {
      await ctx.db.delete("flt_orders", order._id);
      continue;
    }

    const fleet = await ctx.db.get("flt_fleets", order.fleetId);
    if (fleet === null || fleet.gameId !== params.gameId) {
      await ctx.db.delete("flt_orders", order._id);
      continue;
    }

    if (order.targetSystemId !== null) {
      const shipsToMove =
        order.shipCount === undefined ? fleet.strength : order.shipCount;

      const strengthOk =
        Number.isInteger(shipsToMove) &&
        shipsToMove >= 1 &&
        shipsToMove <= fleet.strength;

      if (
        strengthOk &&
        fleet.status === "idle" &&
        fleet.originSystemId !== order.targetSystemId
      ) {
        await dispatchMoveFromFleet(ctx, {
          gameId: params.gameId,
          turnNumber: params.turnNumber,
          fleet,
          targetSystemId: order.targetSystemId,
          shipsToMove,
          dispatchKeySuffix: String(order._id),
        });
      }
    }

    await ctx.db.delete("flt_orders", order._id);
  }
}
