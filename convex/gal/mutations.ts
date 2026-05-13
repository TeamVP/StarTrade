import { mutation } from "../_generated/server";
import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { assertMayAdjustGalaxySystemEmphasis } from "../sim/helpers";

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
    return null;
  },
});
