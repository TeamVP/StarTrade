import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { dispatchMoveFromFleet } from "./fleetDispatch";

/** Ships to send from garrison given total idle strength and slider percentage (1–100). */
export function shipsToDispatchFromPct(totalIdleStrength: number, dispatchPct: number): number {
  if (totalIdleStrength <= 0 || dispatchPct <= 0) return 0;
  if (dispatchPct >= 100) return totalIdleStrength;
  return Math.min(totalIdleStrength, Math.ceil(totalIdleStrength * (dispatchPct / 100)));
}

async function idleFleetsAtSystemForEmpire(
  ctx: MutationCtx,
  params: {
    gameId: Id<"sim_games">;
    empireId: Id<"emp_states">;
    originSystemId: Id<"gal_systems">;
  },
): Promise<Doc<"flt_fleets">[]> {
  const rows = await ctx.db
    .query("flt_fleets")
    .withIndex("by_gameId_and_empireId_and_originSystemId_and_status", (q) =>
      q
        .eq("gameId", params.gameId)
        .eq("empireId", params.empireId)
        .eq("originSystemId", params.originSystemId)
        .eq("status", "idle"),
    )
    .take(32);

  return rows.filter((f) => f.strength > 0);
}

/**
 * After economy/production: repeatedly peel ships from idle garrison fleets toward the route destination.
 */
export async function applyGarrisonRoutes(
  ctx: MutationCtx,
  params: {
    gameId: Id<"sim_games">;
    turnNumber: number;
  },
): Promise<void> {
  const routes = await ctx.db
    .query("flt_garrison_routes")
    .withIndex("by_gameId", (q) => q.eq("gameId", params.gameId))
    .take(128);

  const empires = await ctx.db
    .query("emp_states")
    .withIndex("by_gameId", (q) => q.eq("gameId", params.gameId))
    .take(64);
  const empireById = new Map(empires.map((e) => [e._id, e]));

  const sortedRoutes = [...routes].sort((a, b) => {
    const o = a.originSystemId.localeCompare(b.originSystemId);
    if (o !== 0) return o;
    return a._id.localeCompare(b._id);
  });

  for (const route of sortedRoutes) {
    if (!route.enabled || route.dispatchPct <= 0) continue;

    const empire = empireById.get(route.empireId);
    if (empire === undefined || empire.isCollapsed) continue;

    const system = await ctx.db.get("gal_systems", route.originSystemId);
    if (system === null || system.ownerEmpireId !== route.empireId) continue;

    const fleetsSnapshot = await idleFleetsAtSystemForEmpire(ctx, {
      gameId: params.gameId,
      empireId: route.empireId,
      originSystemId: route.originSystemId,
    });
    const totalIdle = fleetsSnapshot.reduce((s, f) => s + f.strength, 0);
    const shipsBudget = shipsToDispatchFromPct(totalIdle, route.dispatchPct);
    if (shipsBudget <= 0) continue;

    let chunkIndex = 0;
    let remaining = shipsBudget;

    while (remaining > 0) {
      const idleNow = await idleFleetsAtSystemForEmpire(ctx, {
        gameId: params.gameId,
        empireId: route.empireId,
        originSystemId: route.originSystemId,
      });
      if (idleNow.length === 0) break;

      idleNow.sort(
        (a, b) =>
          b.strength - a.strength || a._id.localeCompare(b._id),
      );

      const fleet = idleNow[0];
      const chunk = Math.min(fleet.strength, remaining);
      const fresh = await ctx.db.get("flt_fleets", fleet._id);
      if (fresh === null || fresh.status !== "idle") break;

      const ok = await dispatchMoveFromFleet(ctx, {
        gameId: params.gameId,
        turnNumber: params.turnNumber,
        fleet: fresh,
        targetSystemId: route.destinationSystemId,
        shipsToMove: chunk,
        dispatchKeySuffix: `rt-${route._id}-${params.turnNumber}-${chunkIndex}`,
        eventPayloadExtra: {
          viaGarrisonRoute: true,
          routeId: route._id,
          dispatchPct: route.dispatchPct,
        },
      });

      if (!ok) break;

      remaining -= chunk;
      chunkIndex += 1;
    }
  }
}
