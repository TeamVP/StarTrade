import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { dispatchMoveFromFleet } from "./fleetDispatch";

export function manualOrderOriginKey(params: {
  empireId: Id<"emp_states">;
  originSystemId: Id<"gal_systems">;
}): string {
  return `${params.empireId}:${params.originSystemId}`;
}

export function hasManualOrderOriginLock(
  manualOrderOriginKeys: Set<string> | undefined,
  params: {
    empireId: Id<"emp_states">;
    originSystemId: Id<"gal_systems">;
  },
): boolean {
  return manualOrderOriginKeys?.has(manualOrderOriginKey(params)) ?? false;
}

export async function loadManualOrderOriginLocks(
  ctx: MutationCtx,
  params: {
    gameId: Id<"sim_games">;
    turnNumber: number;
    orders?: Doc<"flt_orders">[];
  },
): Promise<Set<string>> {
  const orders =
    params.orders ??
    (await ctx.db
      .query("flt_orders")
      .withIndex("by_gameId_and_turnNumber", (q) =>
        q.eq("gameId", params.gameId).eq("turnNumber", params.turnNumber),
      )
      .take(128));

  const locks = new Set<string>();
  for (const order of orders) {
    const fleet = await ctx.db.get("flt_fleets", order.fleetId);
    if (fleet === null || fleet.gameId !== params.gameId) continue;
    locks.add(
      manualOrderOriginKey({
        empireId: fleet.empireId,
        originSystemId: fleet.originSystemId,
      }),
    );
  }
  return locks;
}

export async function cleanupFleetOrdersForTurn(
  ctx: MutationCtx,
  params: {
    gameId: Id<"sim_games">;
    turnNumber: number;
  },
): Promise<void> {
  const orders = await ctx.db
    .query("flt_orders")
    .withIndex("by_gameId_and_turnNumber", (q) =>
      q.eq("gameId", params.gameId).eq("turnNumber", params.turnNumber),
    )
    .take(128);

  for (const order of orders) {
    await ctx.db.delete("flt_orders", order._id);
  }
}

export async function applyFleetMoveOrders(
  ctx: MutationCtx,
  params: {
    gameId: Id<"sim_games">;
    turnNumber: number;
    orders: Doc<"flt_orders">[];
  },
): Promise<void> {
  for (const order of params.orders) {
    if (order.movementAppliedAt !== undefined) {
      continue;
    }

    if (order.orderType !== "move") {
      await ctx.db.patch("flt_orders", order._id, {
        movementAppliedAt: Date.now(),
      });
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

    await ctx.db.patch("flt_orders", order._id, {
      movementAppliedAt: Date.now(),
    });
  }
}
