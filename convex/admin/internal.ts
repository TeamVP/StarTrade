import { internalMutation } from "../_generated/server";
import { v } from "convex/values";
import { seedLegacyV1Core } from "../seed/v1CoreSeed";
import { seedV1TwentyMap } from "../seed/v1TwentySeed";

export const seedGameData = internalMutation({
  args: {
    gameId: v.id("sim_games"),
    mapKey: v.string(),
  },
  handler: async (ctx, args) => {
    const existingSystems = await ctx.db
      .query("gal_systems")
      .withIndex("by_gameId", (q) => q.eq("gameId", args.gameId))
      .take(1);

    if (existingSystems.length > 0) {
      throw new Error("Game is already seeded.");
    }

    if (args.mapKey === "v1-twenty") {
      return await seedV1TwentyMap(ctx, args.gameId, args.mapKey);
    }

    const mapScale = args.mapKey === "v1-large" ? 2 : 1;
    return await seedLegacyV1Core(ctx, args.gameId, mapScale, args.mapKey);
  },
});
