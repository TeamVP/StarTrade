import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { findLinkBetweenSystems } from "../gal/linkUtils";
import { insertSimEvent } from "./eventLog";

export function travelTurnsFromLinkCost(travelCost: number): number {
  return Math.max(1, Math.ceil(travelCost / 6));
}

/**
 * Dispatches a move from an idle fleet (full fleet or partial split). Mirrors manual move orders.
 * @returns whether dispatch succeeded (link ok, fleet idle, ship count valid).
 */
export async function dispatchMoveFromFleet(
  ctx: MutationCtx,
  params: {
    gameId: Id<"sim_games">;
    turnNumber: number;
    fleet: Doc<"flt_fleets">;
    targetSystemId: Id<"gal_systems">;
    shipsToMove: number;
    /** Unique suffix for child fleet keys when splitting (e.g. order id or route chunk key). */
    dispatchKeySuffix: string;
    /** Optional extra fields merged into the sim_events payload. */
    eventPayloadExtra?: Record<string, unknown>;
  },
): Promise<boolean> {
  const fleet = params.fleet;
  if (fleet.gameId !== params.gameId || fleet.status !== "idle") {
    return false;
  }
  if (fleet.originSystemId === params.targetSystemId) {
    return false;
  }

  const ships = Math.floor(params.shipsToMove);
  if (!Number.isInteger(ships) || ships < 1 || ships > fleet.strength) {
    return false;
  }

  const link = await findLinkBetweenSystems(
    ctx,
    params.gameId,
    fleet.originSystemId,
    params.targetSystemId,
  );
  if (link === null) {
    return false;
  }

  const turns = travelTurnsFromLinkCost(link.travelCost);
  const etaTurn = params.turnNumber + turns;
  const extra = params.eventPayloadExtra ?? {};

  if (ships < fleet.strength) {
    const childFleetKey = `${fleet.fleetKey}-det-${params.dispatchKeySuffix}`;
    const childName = `${fleet.name} detachment`;
    const childId = await ctx.db.insert("flt_fleets", {
      gameId: params.gameId,
      empireId: fleet.empireId,
      fleetKey: childFleetKey,
      name: childName,
      strength: ships,
      originSystemId: fleet.originSystemId,
      destinationSystemId: params.targetSystemId,
      etaTurn,
      status: "enRoute",
      dispatchedTurn: params.turnNumber,
      travelTurnsTotal: turns,
      retreatSystemId: fleet.originSystemId,
    });
    await ctx.db.patch("flt_fleets", fleet._id, {
      strength: fleet.strength - ships,
    });
    await insertSimEvent(ctx, {
      gameId: params.gameId,
      turnNumber: params.turnNumber,
      eventType: "fleet_dispatched",
      actorType: "fleet",
      actorId: childId,
      targetType: "system",
      targetId: params.targetSystemId,
      summary: `${childName} (${ships} ships) en route (ETA turn ${etaTurn})`,
      payload: {
        fleetId: childId,
        sourceFleetId: fleet._id,
        shipCount: ships,
        targetSystemId: params.targetSystemId,
        etaTurn,
        ...extra,
      },
    });
  } else {
    await ctx.db.patch("flt_fleets", fleet._id, {
      destinationSystemId: params.targetSystemId,
      etaTurn,
      status: "enRoute",
      dispatchedTurn: params.turnNumber,
      travelTurnsTotal: turns,
      retreatSystemId: fleet.originSystemId,
    });
    await insertSimEvent(ctx, {
      gameId: params.gameId,
      turnNumber: params.turnNumber,
      eventType: "fleet_dispatched",
      actorType: "fleet",
      actorId: fleet._id,
      targetType: "system",
      targetId: params.targetSystemId,
      summary: `${fleet.name} en route (ETA turn ${etaTurn})`,
      payload: {
        fleetId: fleet._id,
        shipCount: ships,
        targetSystemId: params.targetSystemId,
        etaTurn,
        ...extra,
      },
    });
  }

  return true;
}
