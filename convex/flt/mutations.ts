import { mutation } from "../_generated/server";
import type { MutationCtx } from "../_generated/server";
import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import type { Id } from "../_generated/dataModel";
import { findLinkBetweenSystems } from "../gal/linkUtils";
import { gameAllowsPlayerActions, touchGameMeaningfulActivity } from "../sim/helpers";
import { invalidateOpenTurnPreparation } from "../sim/turnPreparationInvalidation";

async function resolveControlledAccessForUser(
  ctx: MutationCtx,
  params: {
    gameId: Id<"sim_games">;
    userId: Id<"users">;
  },
): Promise<{
  isAdmin: boolean;
  controlledEmpireId: Id<"emp_states"> | null;
  controlledGameActorId: Id<"sim_game_actors"> | null;
}> {
  const binding = await ctx.db
    .query("usr_game_roles")
    .withIndex("by_gameId_and_userId", (q) =>
      q.eq("gameId", params.gameId).eq("userId", params.userId),
    )
    .unique();

  if (binding === null || !binding.isActive) {
    throw new Error("You are not a member of this game.");
  }
  if (binding.role === "admin") {
    return { isAdmin: true, controlledEmpireId: null, controlledGameActorId: null };
  }
  if (binding.role !== "empire") {
    throw new Error("You do not control that system.");
  }

  const game = await ctx.db.get("sim_games", params.gameId);
  const runtimeVersion = game?.runtimeVersion ?? "v1_empire";
  if (runtimeVersion !== "v2_game_actor") {
    return {
      isAdmin: false,
      controlledEmpireId: binding.empireId,
      controlledGameActorId: null,
    };
  }

  const actor = await ctx.db
    .query("sim_game_actors")
    .withIndex("by_gameId_and_controllerUserId", (q) =>
      q.eq("gameId", params.gameId).eq("controllerUserId", params.userId),
    )
    .unique();
  return {
    isAdmin: false,
    controlledEmpireId: binding.empireId ?? actor?.legacyEmpireId ?? null,
    controlledGameActorId: actor?._id ?? null,
  };
}

async function assertEmpireAccessToOwnedSystem(
  ctx: MutationCtx,
  params: {
    gameId: Id<"sim_games">;
    userId: Id<"users">;
    originSystemId: Id<"gal_systems">;
  },
): Promise<Id<"emp_states">> {
  const system = await ctx.db.get("gal_systems", params.originSystemId);
  if (system === null || system.gameId !== params.gameId) {
    throw new Error("System not found in this game.");
  }
  if (system.ownerEmpireId === null) {
    throw new Error("That system has no empire owner.");
  }

  const { isAdmin, controlledEmpireId, controlledGameActorId } = await resolveControlledAccessForUser(ctx, {
    gameId: params.gameId,
    userId: params.userId,
  });
  const ownsSystem =
    controlledGameActorId !== null && system.ownerGameActorId !== undefined
      ? controlledGameActorId === system.ownerGameActorId
      : controlledEmpireId === system.ownerEmpireId;

  if (!isAdmin && !ownsSystem) {
    throw new Error("You do not control that system.");
  }

  return system.ownerEmpireId;
}

async function assertCanIssueFleetOrder(
  ctx: MutationCtx,
  params: {
    gameId: Id<"sim_games">;
    fleetId: Id<"flt_fleets">;
    userId: Id<"users">;
  },
) {
  const args = params;
  const fleet = await ctx.db.get("flt_fleets", args.fleetId);
  if (fleet === null || fleet.gameId !== args.gameId) {
    throw new Error("Fleet not found in this game.");
  }

  const { isAdmin, controlledEmpireId, controlledGameActorId } = await resolveControlledAccessForUser(ctx, {
    gameId: args.gameId,
    userId: args.userId,
  });
  const ownsFleet =
    controlledGameActorId !== null && fleet.gameActorId !== undefined
      ? controlledGameActorId === fleet.gameActorId
      : controlledEmpireId === fleet.empireId;

  if (!isAdmin && !ownsFleet) {
    throw new Error("You cannot issue orders for this fleet.");
  }

  return {
    fleet,
    isAdmin,
    controlledEmpireId,
    controlledGameActorId,
  };
}

async function assertGameActorMatchesEmpire(
  ctx: MutationCtx,
  params: {
    gameId: Id<"sim_games">;
    gameActorId: Id<"sim_game_actors">;
    empireId: Id<"emp_states">;
  },
): Promise<void> {
  const actor = await ctx.db.get("sim_game_actors", params.gameActorId);
  if (actor === null || actor.gameId !== params.gameId) {
    throw new Error("Game actor not found.");
  }
  if (actor.legacyEmpireId !== params.empireId) {
    throw new Error("Game actor does not match the controlled empire.");
  }
}

async function replaceManualGarrisonRoute(
  ctx: MutationCtx,
  params: {
    gameId: Id<"sim_games">;
    empireId: Id<"emp_states">;
    gameActorId?: Id<"sim_game_actors">;
    originSystemId: Id<"gal_systems">;
    destinationSystemId: Id<"gal_systems">;
    dispatchPct: number;
    enabled: boolean;
  },
): Promise<Id<"flt_garrison_routes">> {
  const pct = Math.round(params.dispatchPct);
  if (!Number.isInteger(pct) || pct < 0 || pct > 100) {
    throw new Error("dispatchPct must be an integer from 0 through 100.");
  }
  if (params.originSystemId === params.destinationSystemId) {
    throw new Error("Origin and destination must differ.");
  }

  const origin = await ctx.db.get("gal_systems", params.originSystemId);
  const originOwnedByIssuer =
    origin !== null &&
    origin.gameId === params.gameId &&
    ((params.gameActorId !== undefined && origin.ownerGameActorId !== undefined
      ? origin.ownerGameActorId === params.gameActorId
      : false) || origin.ownerEmpireId === params.empireId);
  if (
    origin === null ||
    origin.gameId !== params.gameId ||
    !originOwnedByIssuer
  ) {
    throw new Error("Standing routes must start from a system owned by the issuing empire.");
  }

  const destination = await ctx.db.get("gal_systems", params.destinationSystemId);
  if (destination === null || destination.gameId !== params.gameId) {
    throw new Error("Destination system not found in this game.");
  }

  const link = await findLinkBetweenSystems(
    ctx,
    params.gameId,
    params.originSystemId,
    params.destinationSystemId,
  );
  if (link === null) {
    throw new Error("No direct hyperspace link to that system.");
  }

  const existing = await ctx.db
    .query("flt_garrison_routes")
    .withIndex("by_gameId_and_originSystemId", (q) =>
      q.eq("gameId", params.gameId).eq("originSystemId", params.originSystemId),
    )
    .take(16);

  for (const row of existing) {
    if (row.empireId === params.empireId) {
      await ctx.db.delete("flt_garrison_routes", row._id);
    }
  }

  return await ctx.db.insert("flt_garrison_routes", {
    gameId: params.gameId,
    empireId: params.empireId,
    ...(params.gameActorId !== undefined ? { gameActorId: params.gameActorId } : {}),
    originSystemId: params.originSystemId,
    destinationSystemId: params.destinationSystemId,
    dispatchPct: pct,
    enabled: params.enabled,
    managedByStrategy: false,
  });
}

export const issueFleetOrder = mutation({
  args: {
    gameId: v.id("sim_games"),
    gameActorId: v.optional(v.id("sim_game_actors")),
    fleetId: v.id("flt_fleets"),
    /** Deprecated client hint; orders are stamped with the authoritative server-side current turn. */
    turnNumber: v.optional(v.number()),
    orderType: v.union(v.literal("move"), v.literal("hold")),
    targetSystemId: v.union(v.id("gal_systems"), v.null()),
    shipCount: v.optional(v.number()),
    standingRouteDispatchPct: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      throw new Error("Authentication required.");
    }

    const access = await assertCanIssueFleetOrder(ctx, {
      gameId: args.gameId,
      fleetId: args.fleetId,
      userId,
    });

    const fleet = access.fleet;
    if (args.gameActorId !== undefined) {
      await assertGameActorMatchesEmpire(ctx, {
        gameId: args.gameId,
        gameActorId: args.gameActorId,
        empireId: fleet.empireId,
      });
    }

    const game = await ctx.db.get("sim_games", args.gameId);
    if (game === null) {
      throw new Error("Game not found.");
    }
    if (!gameAllowsPlayerActions(game.status)) {
      throw new Error("Game must be running or paused to issue fleet orders.");
    }

    if (args.orderType !== "move" && args.shipCount !== undefined) {
      throw new Error("shipCount is only valid for move orders.");
    }
    if (args.orderType !== "move" && args.standingRouteDispatchPct !== undefined) {
      throw new Error("Standing routes can only be created with move orders.");
    }

    if (args.orderType === "move") {
      if (args.targetSystemId === null) {
        throw new Error("Move orders require a target system.");
      }
      if (fleet.status !== "idle") {
        throw new Error("Fleet must be idle to receive a move order.");
      }
      if (fleet.originSystemId === args.targetSystemId) {
        throw new Error("Fleet is already at the target system.");
      }

      const shipsToMove = args.shipCount ?? fleet.strength;
      if (
        !Number.isInteger(shipsToMove) ||
        shipsToMove < 1 ||
        shipsToMove > fleet.strength
      ) {
        throw new Error(
          `shipCount must be an integer from 1 through ${fleet.strength} (ships currently at this fleet).`,
        );
      }

      const link = await findLinkBetweenSystems(
        ctx,
        args.gameId,
        fleet.originSystemId,
        args.targetSystemId,
      );
      if (link === null) {
        throw new Error("No direct hyperspace link to that system.");
      }
    } else if (args.targetSystemId !== null) {
      throw new Error("Hold orders cannot specify a target system.");
    }

    const existingOrders = await ctx.db
      .query("flt_orders")
      .withIndex("by_gameId_and_fleetId", (q) =>
        q.eq("gameId", args.gameId).eq("fleetId", args.fleetId),
      )
      .take(32);

    for (const row of existingOrders) {
      if (row.turnNumber === game.currentTurn) {
        await ctx.db.delete("flt_orders", row._id);
      }
    }

    const resolvedOrderGameActorId =
      args.gameActorId ?? access.controlledGameActorId ?? fleet.gameActorId;

    const orderId = await ctx.db.insert("flt_orders", {
      gameId: args.gameId,
      ...(resolvedOrderGameActorId !== null && resolvedOrderGameActorId !== undefined
        ? { gameActorId: resolvedOrderGameActorId }
        : {}),
      fleetId: args.fleetId,
      issuedByUserId: userId,
      turnNumber: game.currentTurn,
      orderType: args.orderType,
      targetSystemId: args.targetSystemId,
      ...(args.shipCount !== undefined ? { shipCount: args.shipCount } : {}),
      issuedAt: Date.now(),
    });

    if (args.standingRouteDispatchPct !== undefined) {
      if (args.orderType !== "move" || args.targetSystemId === null) {
        throw new Error("Standing routes require a move target.");
      }
      await replaceManualGarrisonRoute(ctx, {
        gameId: args.gameId,
        empireId: fleet.empireId,
        ...(resolvedOrderGameActorId !== null && resolvedOrderGameActorId !== undefined
          ? { gameActorId: resolvedOrderGameActorId }
          : {}),
        originSystemId: fleet.originSystemId,
        destinationSystemId: args.targetSystemId,
        dispatchPct: args.standingRouteDispatchPct,
        enabled: true,
      });
    }

    await invalidateOpenTurnPreparation(ctx, args.gameId);
    await touchGameMeaningfulActivity(ctx, args.gameId, { humanAction: true });

    return orderId;
  },
});

export const setGarrisonRoute = mutation({
  args: {
    gameId: v.id("sim_games"),
    gameActorId: v.optional(v.id("sim_game_actors")),
    originSystemId: v.id("gal_systems"),
    destinationSystemId: v.union(v.id("gal_systems"), v.null()),
    dispatchPct: v.number(),
    enabled: v.boolean(),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      throw new Error("Authentication required.");
    }

    const game = await ctx.db.get("sim_games", args.gameId);
    if (game === null) {
      throw new Error("Game not found.");
    }
    if (!gameAllowsPlayerActions(game.status)) {
      throw new Error("Game must be running or paused to configure routes.");
    }

    const empireId = await assertEmpireAccessToOwnedSystem(ctx, {
      gameId: args.gameId,
      userId,
      originSystemId: args.originSystemId,
    });
    const access = await resolveControlledAccessForUser(ctx, {
      gameId: args.gameId,
      userId,
    });
    if (args.gameActorId !== undefined) {
      await assertGameActorMatchesEmpire(ctx, {
        gameId: args.gameId,
        gameActorId: args.gameActorId,
        empireId,
      });
    }

    const pct = Math.round(args.dispatchPct);
    if (!Number.isInteger(pct) || pct < 0 || pct > 100) {
      throw new Error("dispatchPct must be an integer from 0 through 100.");
    }

    const existing = await ctx.db
      .query("flt_garrison_routes")
      .withIndex("by_gameId_and_originSystemId", (q) =>
        q.eq("gameId", args.gameId).eq("originSystemId", args.originSystemId),
      )
      .take(16);

    for (const row of existing) {
      if (row.empireId === empireId) {
        await ctx.db.delete("flt_garrison_routes", row._id);
      }
    }

    if (args.destinationSystemId === null) {
      await invalidateOpenTurnPreparation(ctx, args.gameId);
      await touchGameMeaningfulActivity(ctx, args.gameId, { humanAction: true });
      return null;
    }

    const resolvedRouteGameActorId = args.gameActorId ?? access.controlledGameActorId;

    const routeId = await replaceManualGarrisonRoute(ctx, {
      gameId: args.gameId,
      empireId,
      ...(resolvedRouteGameActorId !== null && resolvedRouteGameActorId !== undefined
        ? { gameActorId: resolvedRouteGameActorId }
        : {}),
      originSystemId: args.originSystemId,
      destinationSystemId: args.destinationSystemId,
      dispatchPct: pct,
      enabled: args.enabled,
    });
    await invalidateOpenTurnPreparation(ctx, args.gameId);
    await touchGameMeaningfulActivity(ctx, args.gameId, { humanAction: true });
    return routeId;
  },
});
