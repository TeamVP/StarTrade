import { mutation } from "../_generated/server";
import type { MutationCtx } from "../_generated/server";
import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import type { Id } from "../_generated/dataModel";
import { findLinkBetweenSystems } from "../gal/linkUtils";
import { gameAllowsPlayerActions } from "../sim/helpers";

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

  const binding = await ctx.db
    .query("usr_game_roles")
    .withIndex("by_gameId_and_userId", (q) =>
      q.eq("gameId", params.gameId).eq("userId", params.userId),
    )
    .unique();

  if (binding === null || !binding.isActive) {
    throw new Error("You are not a member of this game.");
  }

  const isAdmin = binding.role === "admin";
  const ownsSystem =
    binding.role === "empire" &&
    binding.empireId !== null &&
    binding.empireId === system.ownerEmpireId;

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

  const binding = await ctx.db
    .query("usr_game_roles")
    .withIndex("by_gameId_and_userId", (q) =>
      q.eq("gameId", args.gameId).eq("userId", args.userId),
    )
    .unique();

  if (binding === null || !binding.isActive) {
    throw new Error("You are not a member of this game.");
  }

  const isAdmin = binding.role === "admin";
  const ownsEmpire =
    binding.role === "empire" &&
    binding.empireId !== null &&
    binding.empireId === fleet.empireId;

  if (!isAdmin && !ownsEmpire) {
    throw new Error("You cannot issue orders for this fleet.");
  }
}

export const issueFleetOrder = mutation({
  args: {
    gameId: v.id("sim_games"),
    fleetId: v.id("flt_fleets"),
    turnNumber: v.number(),
    orderType: v.union(v.literal("move"), v.literal("hold"), v.literal("retreat")),
    targetSystemId: v.union(v.id("gal_systems"), v.null()),
    shipCount: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      throw new Error("Authentication required.");
    }

    await assertCanIssueFleetOrder(ctx, {
      gameId: args.gameId,
      fleetId: args.fleetId,
      userId,
    });

    const fleet = await ctx.db.get("flt_fleets", args.fleetId);
    if (fleet === null) {
      throw new Error("Fleet not found.");
    }

    const game = await ctx.db.get("sim_games", args.gameId);
    if (game === null) {
      throw new Error("Game not found.");
    }
    if (!gameAllowsPlayerActions(game.status)) {
      throw new Error("Game must be running or paused to issue fleet orders.");
    }
    if (args.turnNumber !== game.currentTurn) {
      throw new Error(`Orders must target the current turn (${game.currentTurn}).`);
    }

    if (args.orderType !== "move" && args.shipCount !== undefined) {
      throw new Error("shipCount is only valid for move orders.");
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
    } else if (args.orderType === "retreat") {
      if (args.targetSystemId !== null) {
        throw new Error("Retreat orders cannot specify a target system.");
      }
      if (fleet.status !== "engaged" || fleet.activeBattleId === undefined) {
        throw new Error("Fleet must be engaged in battle to retreat.");
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

    return await ctx.db.insert("flt_orders", {
      gameId: args.gameId,
      fleetId: args.fleetId,
      issuedByUserId: userId,
      turnNumber: args.turnNumber,
      orderType: args.orderType,
      targetSystemId: args.targetSystemId,
      ...(args.shipCount !== undefined ? { shipCount: args.shipCount } : {}),
      issuedAt: Date.now(),
    });
  },
});

export const setGarrisonRoute = mutation({
  args: {
    gameId: v.id("sim_games"),
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
      return null;
    }

    if (args.originSystemId === args.destinationSystemId) {
      throw new Error("Origin and destination must differ.");
    }

    const link = await findLinkBetweenSystems(
      ctx,
      args.gameId,
      args.originSystemId,
      args.destinationSystemId,
    );
    if (link === null) {
      throw new Error("No direct hyperspace link to that system.");
    }

    return await ctx.db.insert("flt_garrison_routes", {
      gameId: args.gameId,
      empireId,
      originSystemId: args.originSystemId,
      destinationSystemId: args.destinationSystemId,
      dispatchPct: pct,
      enabled: args.enabled,
    });
  },
});
