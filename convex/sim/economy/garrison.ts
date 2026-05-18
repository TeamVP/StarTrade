import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx } from "../../_generated/server";
import { resolveGameActorIdForEmpire } from "../systemHoldings";

/**
 * Adds military ships to an empire's garrison at a system: merges into an idle fleet
 * without a pending order when possible; otherwise creates a new fleet row.
 */
export async function addShipsToSystemGarrison(
  ctx: MutationCtx,
  params: {
    gameId: Id<"sim_games">;
    system: Doc<"gal_systems">;
    empire: Doc<"emp_states">;
    shipsToAdd: number;
    fleetIdsWithOrdersThisTurn: Set<string>;
  },
): Promise<void> {
  if (params.shipsToAdd <= 0) return;
  if (params.system.ownerEmpireId !== params.empire._id) return;

  const fleets = await ctx.db
    .query("flt_fleets")
    .withIndex("by_gameId_and_empireId_and_originSystemId_and_status", (q) =>
      q
        .eq("gameId", params.gameId)
        .eq("empireId", params.empire._id)
        .eq("originSystemId", params.system._id)
        .eq("status", "idle"),
    )
    .take(16);

  const withoutOrder = fleets.filter(
    (f) => !params.fleetIdsWithOrdersThisTurn.has(f._id as string),
  );

  const ownerGameActorId =
    params.system.ownerGameActorId ??
    (await resolveGameActorIdForEmpire(ctx, {
      gameId: params.gameId,
      empireId: params.empire._id,
    })) ??
    null;

  if (withoutOrder.length > 0) {
    withoutOrder.sort((a, b) => a._id.localeCompare(b._id));
    const keeper = withoutOrder[0];
    let total = keeper.strength + params.shipsToAdd;
    for (let i = 1; i < withoutOrder.length; i++) {
      total += withoutOrder[i].strength;
      await ctx.db.delete("flt_fleets", withoutOrder[i]._id);
    }
    await ctx.db.patch("flt_fleets", keeper._id, {
      strength: total,
      ...((keeper.gameActorId ?? undefined) !== (ownerGameActorId ?? undefined)
        ? { gameActorId: ownerGameActorId ?? undefined }
        : {}),
    });
    return;
  }

  const fleetKey = `garrison-${params.empire.empireKey}-${params.system.systemKey}`;
  await ctx.db.insert("flt_fleets", {
    gameId: params.gameId,
    empireId: params.empire._id,
    ...(ownerGameActorId !== null ? { gameActorId: ownerGameActorId } : {}),
    fleetKey,
    name: `${params.system.name} Garrison`,
    strength: params.shipsToAdd,
    originSystemId: params.system._id,
    destinationSystemId: null,
    etaTurn: null,
    status: "idle",
  });
}
