import { query, type QueryCtx } from "../_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";

function resolveGameRuntimeVersion(
  runtimeVersion: "v1_empire" | "v2_game_actor" | null | undefined,
): "v1_empire" | "v2_game_actor" {
  return runtimeVersion ?? "v1_empire";
}

async function listActorsForGame(
  ctx: QueryCtx,
  gameId: Id<"sim_games">,
): Promise<{
  actorById: Map<Id<"sim_game_actors">, Doc<"sim_game_actors">>;
  actorByLegacyEmpireId: Map<Id<"emp_states">, Doc<"sim_game_actors">>;
}> {
  const actors: Doc<"sim_game_actors">[] = await ctx.db
    .query("sim_game_actors")
    .withIndex("by_gameId", (q) => q.eq("gameId", gameId))
    .collect();
  return {
    actorById: new Map(actors.map((actor) => [actor._id, actor] as const)),
    actorByLegacyEmpireId: new Map(
      actors
        .filter((actor) => actor.legacyEmpireId !== null)
        .map((actor) => [actor.legacyEmpireId!, actor] as const),
    ),
  };
}

async function resolveControlledEmpireIdForRole(
  ctx: QueryCtx,
  params: {
    gameId: Id<"sim_games">;
    runtimeVersion: "v1_empire" | "v2_game_actor";
    userId: Id<"users">;
    role: "observer" | "empire" | "trader" | "admin";
    empireId: Id<"emp_states"> | null;
  },
): Promise<Id<"emp_states"> | null> {
  if (params.role !== "empire") {
    return null;
  }
  if (params.empireId !== null) {
    return params.empireId;
  }
  if (params.runtimeVersion !== "v2_game_actor") {
    return null;
  }

  const actor = await ctx.db
    .query("sim_game_actors")
    .withIndex("by_gameId_and_controllerUserId", (q) =>
      q.eq("gameId", params.gameId).eq("controllerUserId", params.userId),
    )
    .unique();
  return actor?.legacyEmpireId ?? null;
}

export const listFleetsForGame = query({
  args: { gameId: v.id("sim_games"), limit: v.number() },
  handler: async (ctx, args) => {
    const game = await ctx.db.get("sim_games", args.gameId);
    const runtimeVersion = resolveGameRuntimeVersion(game?.runtimeVersion);
    const fleets = await ctx.db
      .query("flt_fleets")
      .withIndex("by_gameId", (q) => q.eq("gameId", args.gameId))
      .take(args.limit);
    if (runtimeVersion !== "v2_game_actor") {
      return fleets.map((fleet) => ({
        ...fleet,
        runtimeVersion,
        actorId: null,
        actorSlotNumber: null,
        actorLabel: null,
        actorDisplayName: null,
      }));
    }

    const { actorById, actorByLegacyEmpireId } = await listActorsForGame(
      ctx,
      args.gameId,
    );
    return fleets.map((fleet) => {
      const actor =
        (fleet.gameActorId !== undefined ? actorById.get(fleet.gameActorId) : null) ??
        actorByLegacyEmpireId.get(fleet.empireId) ??
        null;
      return {
        ...fleet,
        runtimeVersion,
        actorId: actor?._id ?? null,
        actorSlotNumber: actor?.slotNumber ?? null,
        actorLabel: actor?.factionLabelSnapshot ?? null,
        actorDisplayName: actor?.displayNameSnapshot ?? null,
      };
    });
  },
});

export const listPendingMoveOrdersForTurn = query({
  args: {
    gameId: v.id("sim_games"),
    turnNumber: v.number(),
    limit: v.number(),
  },
  handler: async (ctx, args) => {
    const game = await ctx.db.get("sim_games", args.gameId);
    const runtimeVersion = resolveGameRuntimeVersion(game?.runtimeVersion);
    const orders = await ctx.db
      .query("flt_orders")
      .withIndex("by_gameId_and_turnNumber", (q) =>
        q.eq("gameId", args.gameId).eq("turnNumber", args.turnNumber),
      )
      .take(args.limit);

    const actorMaps =
      runtimeVersion === "v2_game_actor"
        ? await listActorsForGame(ctx, args.gameId)
        : { actorById: new Map(), actorByLegacyEmpireId: new Map() };

    const result: Array<{
      orderId: Id<"flt_orders">;
      fleetId: Id<"flt_fleets">;
      fleetName: string;
      originSystemId: Id<"gal_systems">;
      targetSystemId: Id<"gal_systems">;
      shipCount: number;
      runtimeVersion: "v1_empire" | "v2_game_actor";
      actorId: Id<"sim_game_actors"> | null;
      actorSlotNumber: number | null;
      actorLabel: string | null;
      actorDisplayName: string | null;
    }> = [];
    for (const order of orders) {
      if (order.movementAppliedAt !== undefined) continue;
      if (order.orderType !== "move" || order.targetSystemId === null) continue;
      const fleet: Doc<"flt_fleets"> | null = await ctx.db.get(
        "flt_fleets",
        order.fleetId,
      );
      if (fleet === null) continue;
      const actor =
        runtimeVersion === "v2_game_actor"
          ? (order.gameActorId !== undefined
              ? actorMaps.actorById.get(order.gameActorId)
              : null) ??
            (fleet.gameActorId !== undefined
              ? actorMaps.actorById.get(fleet.gameActorId)
              : null) ??
            actorMaps.actorByLegacyEmpireId.get(fleet.empireId) ??
            null
          : null;
      result.push({
        orderId: order._id,
        fleetId: order.fleetId,
        fleetName: fleet.name,
        originSystemId: fleet.originSystemId,
        targetSystemId: order.targetSystemId,
        shipCount:
          order.shipCount === undefined ? fleet.strength : order.shipCount,
        runtimeVersion,
        actorId: actor?._id ?? null,
        actorSlotNumber: actor?.slotNumber ?? null,
        actorLabel: actor?.factionLabelSnapshot ?? null,
        actorDisplayName: actor?.displayNameSnapshot ?? null,
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

    const game = await ctx.db.get("sim_games", args.gameId);
    const runtimeVersion = resolveGameRuntimeVersion(game?.runtimeVersion);

    const attachActorMetadata = async <
      T extends { empireId: Id<"emp_states">; gameActorId?: Id<"sim_game_actors"> | null },
    >(
      rows: T[],
    ) => {
      if (runtimeVersion !== "v2_game_actor") {
        return rows.map((row) => ({
          ...row,
          runtimeVersion,
          actorId: null,
          actorSlotNumber: null,
          actorLabel: null,
          actorDisplayName: null,
        }));
      }
      const actors: Doc<"sim_game_actors">[] = await ctx.db
        .query("sim_game_actors")
        .withIndex("by_gameId", (q) => q.eq("gameId", args.gameId))
        .collect();
      const actorById = new Map(actors.map((actor) => [actor._id, actor] as const));
      const actorByLegacyEmpireId = new Map(
        actors
          .filter((actor) => actor.legacyEmpireId !== null)
          .map((actor) => [actor.legacyEmpireId!, actor] as const),
      );
      return rows.map((row) => {
        const actor =
          (row.gameActorId !== undefined && row.gameActorId !== null
            ? actorById.get(row.gameActorId)
            : null) ??
          actorByLegacyEmpireId.get(row.empireId) ??
          null;
        return {
          ...row,
          runtimeVersion,
          actorId: actor?._id ?? null,
          actorSlotNumber: actor?.slotNumber ?? null,
          actorLabel: actor?.factionLabelSnapshot ?? null,
          actorDisplayName: actor?.displayNameSnapshot ?? null,
        };
      });
    };

    if (binding.role === "admin") {
      return await attachActorMetadata(await ctx.db
        .query("flt_garrison_routes")
        .withIndex("by_gameId", (q) => q.eq("gameId", args.gameId))
        .take(128));
    }

    const empireId = await resolveControlledEmpireIdForRole(ctx, {
      gameId: args.gameId,
      runtimeVersion,
      userId,
      role: binding.role,
      empireId: binding.empireId,
    });
    if (empireId === null) {
      return [];
    }

    return await attachActorMetadata(await ctx.db
      .query("flt_garrison_routes")
      .withIndex("by_gameId_and_empireId", (q) =>
        q.eq("gameId", args.gameId).eq("empireId", empireId),
      )
      .take(64));
  },
});
