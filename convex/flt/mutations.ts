import { mutation } from "../_generated/server";
import type { MutationCtx } from "../_generated/server";
import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import type { Id } from "../_generated/dataModel";
import { findLinkBetweenSystems } from "../gal/linkUtils";

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
    if (game.status !== "running") {
      throw new Error("Game must be running to issue fleet orders.");
    }
    if (args.turnNumber !== game.currentTurn) {
      throw new Error(`Orders must target the current turn (${game.currentTurn}).`);
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

      const link = await findLinkBetweenSystems(
        ctx,
        args.gameId,
        fleet.originSystemId,
        args.targetSystemId,
      );
      if (link === null) {
        throw new Error("No direct hyperspace link to that system.");
      }
    }

    return await ctx.db.insert("flt_orders", {
      ...args,
      issuedByUserId: userId,
      issuedAt: Date.now(),
    });
  },
});
