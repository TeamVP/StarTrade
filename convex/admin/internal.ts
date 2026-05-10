import { internalMutation } from "../_generated/server";
import { v } from "convex/values";

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

    const mapScale = args.mapKey === "v1-large" ? 2 : 1;

    const systemAlpha = await ctx.db.insert("gal_systems", {
      gameId: args.gameId,
      systemKey: "alpha",
      name: "Alpha Prime",
      x: 120 * mapScale,
      y: 160 * mapScale,
      resourceRichness: 0.8,
      isHomeworld: true,
      ownerEmpireId: null,
    });
    const systemBeta = await ctx.db.insert("gal_systems", {
      gameId: args.gameId,
      systemKey: "beta",
      name: "Beta Reach",
      x: 420 * mapScale,
      y: 260 * mapScale,
      resourceRichness: 0.6,
      isHomeworld: true,
      ownerEmpireId: null,
    });
    const systemGamma = await ctx.db.insert("gal_systems", {
      gameId: args.gameId,
      systemKey: "gamma",
      name: "Gamma Drift",
      x: 260 * mapScale,
      y: 420 * mapScale,
      resourceRichness: 0.7,
      isHomeworld: false,
      ownerEmpireId: null,
    });

    const auroraEmpireId = await ctx.db.insert("emp_states", {
      gameId: args.gameId,
      empireKey: "aurora",
      name: "Aurora Combine",
      colorHex: "#22d3ee",
      treasury: 1200,
      foodStockpile: 500,
      population: 100,
      stability: 0.85,
      isCollapsed: false,
      homeSystemId: systemAlpha,
    });
    const ironEmpireId = await ctx.db.insert("emp_states", {
      gameId: args.gameId,
      empireKey: "iron",
      name: "Iron Dominion",
      colorHex: "#f97316",
      treasury: 1200,
      foodStockpile: 500,
      population: 100,
      stability: 0.85,
      isCollapsed: false,
      homeSystemId: systemBeta,
    });

    await ctx.db.patch("gal_systems", systemAlpha, { ownerEmpireId: auroraEmpireId });
    await ctx.db.patch("gal_systems", systemBeta, { ownerEmpireId: ironEmpireId });

    await ctx.db.insert("gal_links", {
      gameId: args.gameId,
      fromSystemId: systemAlpha,
      toSystemId: systemGamma,
      distance: 7,
      travelCost: 14,
    });
    await ctx.db.insert("gal_links", {
      gameId: args.gameId,
      fromSystemId: systemGamma,
      toSystemId: systemBeta,
      distance: 6,
      travelCost: 12,
    });

    await ctx.db.insert("emp_system_holdings", {
      gameId: args.gameId,
      empireId: auroraEmpireId,
      systemId: systemAlpha,
      taxRate: 0.18,
      productionModifier: 1.1,
      unrest: 0.05,
    });
    await ctx.db.insert("emp_system_holdings", {
      gameId: args.gameId,
      empireId: ironEmpireId,
      systemId: systemBeta,
      taxRate: 0.2,
      productionModifier: 1.05,
      unrest: 0.06,
    });

    await ctx.db.insert("flt_fleets", {
      gameId: args.gameId,
      empireId: auroraEmpireId,
      fleetKey: "aurora-1",
      name: "Aurora Expedition",
      strength: 100,
      originSystemId: systemAlpha,
      destinationSystemId: null,
      etaTurn: null,
      status: "idle",
    });
    await ctx.db.insert("flt_fleets", {
      gameId: args.gameId,
      empireId: ironEmpireId,
      fleetKey: "iron-1",
      name: "Iron Vanguard",
      strength: 100,
      originSystemId: systemBeta,
      destinationSystemId: null,
      etaTurn: null,
      status: "idle",
    });

    return {
      systems: 3,
      empires: 2,
      mapKey: args.mapKey,
    };
  },
});
