import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { v } from "convex/values";
import { V1_SPIRAL_LANE_KEYS, V1_SPIRAL_SYSTEMS } from "./v1Spiral";

const SYSTEM_BATCH = 40;
const LINK_BATCH = 60;

/**
 * Seeds the 200-star v1-spiral map across many short mutations (Convex mutations ~1s limit).
 * Purges any partial galaxy rows for this game first so retries stay idempotent.
 */
export const runFullSpiralSeed = internalAction({
  args: {
    gameId: v.id("sim_games"),
    colorPrefsUserId: v.optional(v.id("users")),
    seedTraders: v.boolean(),
  },
  handler: async (ctx, args) => {
    await ctx.runMutation(internal.seed.v1SpiralBulk.spiralPurgeGalaxyRows, {
      gameId: args.gameId,
    });
    const n = V1_SPIRAL_SYSTEMS.length;
    for (let start = 0; start < n; start += SYSTEM_BATCH) {
      await ctx.runMutation(internal.seed.v1SpiralBulk.spiralInsertSystemsSlice, {
        gameId: args.gameId,
        startIdx: start,
        endIdx: Math.min(start + SYSTEM_BATCH, n),
      });
    }
    await ctx.runMutation(internal.seed.v1SpiralBulk.spiralFinishPostSystems, {
      gameId: args.gameId,
      colorPrefsUserId: args.colorPrefsUserId,
    });
    const nl = V1_SPIRAL_LANE_KEYS.length;
    for (let lo = 0; lo < nl; lo += LINK_BATCH) {
      await ctx.runMutation(internal.seed.v1SpiralBulk.spiralInsertLinksSlice, {
        gameId: args.gameId,
        linkStartIdx: lo,
        linkEndIdx: Math.min(lo + LINK_BATCH, nl),
      });
    }
    if (args.seedTraders) {
      await ctx.runMutation(internal.seed.v1SpiralBulk.spiralSeedTraders, {
        gameId: args.gameId,
      });
    }
    return null;
  },
});
