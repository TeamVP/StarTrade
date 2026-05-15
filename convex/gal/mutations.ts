import { mutation } from "../_generated/server";
import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import {
  assertMayAdjustGalaxySystemEmphasis,
  gameAllowsPlayerActions,
  touchGameMeaningfulActivity,
} from "../sim/helpers";

async function resolvePriorityStarEmpireId(
  ctx: MutationCtx,
  params: {
    gameId: Id<"sim_games">;
    userId: Id<"users">;
    requestedEmpireId?: Id<"emp_states">;
  },
): Promise<Id<"emp_states">> {
  const binding = await ctx.db
    .query("usr_game_roles")
    .withIndex("by_gameId_and_userId", (q) =>
      q.eq("gameId", params.gameId).eq("userId", params.userId),
    )
    .unique();
  if (binding === null || !binding.isActive) {
    throw new Error("You need an active role in this game.");
  }

  if (binding.role === "empire" && binding.empireId !== null) {
    if (
      params.requestedEmpireId !== undefined &&
      params.requestedEmpireId !== binding.empireId
    ) {
      throw new Error("Empire players can only mark Priority stars for their own empire.");
    }
    return binding.empireId;
  }

  if (binding.role === "admin") {
    if (params.requestedEmpireId === undefined) {
      throw new Error("Choose which empire this Priority star belongs to.");
    }
    const empire = await ctx.db.get("emp_states", params.requestedEmpireId);
    if (empire === null || empire.gameId !== params.gameId) {
      throw new Error("Empire not found in this game.");
    }
    return empire._id;
  }

  throw new Error("Only empire players and game admins can mark Priority stars.");
}

/**
 * Save the ships-effort slider for a star system. emphasisFood is auto-derived so that
 * emphasisFood + emphasisShips + emphasisResearch = 100 (surplus goes to food, floored at 0).
 * Only the owning empire's players (or admins) should call this.
 */
export const setEmphasis = mutation({
  args: {
    gameId: v.id("sim_games"),
    systemId: v.id("gal_systems"),
    emphasisShips: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");

    const system = await assertMayAdjustGalaxySystemEmphasis(ctx, {
      gameId: args.gameId,
      userId,
      systemId: args.systemId,
    });

    const emphasisResearch = system.emphasisResearch ?? 33;
    const ships = Math.max(0, Math.min(100 - emphasisResearch, Math.round(args.emphasisShips)));
    const food = Math.max(0, 100 - ships - emphasisResearch);

    await ctx.db.patch("gal_systems", args.systemId, {
      emphasisShips: ships,
      emphasisFood: food,
    });
    await touchGameMeaningfulActivity(ctx, args.gameId, { humanAction: true });
    return null;
  },
});

const MAX_FOOD_IMPORT_SUBSIDY_PER_UNIT = 30;

/**
 * Raise or lower extra credits per food unit this colony pays importers (atop market foodPrice).
 * Same access as production emphasis (owning empire or game admin).
 */
export const adjustFoodImportSubsidy = mutation({
  args: {
    gameId: v.id("sim_games"),
    systemId: v.id("gal_systems"),
    delta: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");

    const system = await assertMayAdjustGalaxySystemEmphasis(ctx, {
      gameId: args.gameId,
      userId,
      systemId: args.systemId,
    });

    const cur = system.foodImportSubsidyPerUnit ?? 0;
    const next = Math.max(
      0,
      Math.min(MAX_FOOD_IMPORT_SUBSIDY_PER_UNIT, Math.round(cur + args.delta)),
    );

    await ctx.db.patch("gal_systems", args.systemId, {
      foodImportSubsidyPerUnit: next,
    });
    await touchGameMeaningfulActivity(ctx, args.gameId, { humanAction: true });
    return null;
  },
});

export const setPriorityStar = mutation({
  args: {
    gameId: v.id("sim_games"),
    systemId: v.id("gal_systems"),
    enabled: v.boolean(),
    empireId: v.optional(v.id("emp_states")),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");

    const game = await ctx.db.get("sim_games", args.gameId);
    if (game === null) throw new Error("Game not found.");
    if (!gameAllowsPlayerActions(game.status)) {
      throw new Error("Game must be running or paused to mark Priority stars.");
    }

    const system = await ctx.db.get("gal_systems", args.systemId);
    if (system === null || system.gameId !== args.gameId) {
      throw new Error("System not found in this game.");
    }

    const empireId = await resolvePriorityStarEmpireId(ctx, {
      gameId: args.gameId,
      userId,
      requestedEmpireId: args.empireId,
    });
    const existing = await ctx.db
      .query("emp_priority_stars")
      .withIndex("by_gameId_and_empireId_and_systemId", (q) =>
        q.eq("gameId", args.gameId).eq("empireId", empireId).eq("systemId", args.systemId),
      )
      .unique();

    if (!args.enabled) {
      if (existing !== null) {
        await ctx.db.delete("emp_priority_stars", existing._id);
      }
      await touchGameMeaningfulActivity(ctx, args.gameId, { humanAction: true });
      return null;
    }

    if (existing === null) {
      await ctx.db.insert("emp_priority_stars", {
        gameId: args.gameId,
        empireId,
        systemId: args.systemId,
        createdByUserId: userId,
        createdAt: Date.now(),
      });
    }
    await touchGameMeaningfulActivity(ctx, args.gameId, { humanAction: true });
    return null;
  },
});
