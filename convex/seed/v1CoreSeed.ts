import type { MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { seedNpcTraderIdentitiesForGame } from "./npcTraderIdentitiesSeed";
import { pickEmpireCatalogColorHex } from "./empireColorPrefLookup";

function seedBaseProductivity(resourceRichness: number): number {
  return Math.max(1, Math.min(10, Math.round(3 + resourceRichness * 7)));
}

/** Original three-system tutorial galaxy (optionally scaled for `v1-large`). */
export async function seedLegacyV1Core(
  ctx: MutationCtx,
  gameId: Id<"sim_games">,
  mapScale: number,
  mapKey: string,
  empireColorPrefLookup: Record<string, string> = {},
): Promise<{ systems: number; empires: number; mapKey: string }> {
  const systemAlpha = await ctx.db.insert("gal_systems", {
    gameId,
    systemKey: "alpha",
    name: "Alpha Prime",
    x: 120 * mapScale,
    y: 160 * mapScale,
    resourceRichness: 0.8,
    baseProductivity: seedBaseProductivity(0.8),
    isHomeworld: true,
    ownerEmpireId: null,
    population: 50_000_000,
    stockFood: 5_000,
    stockWeapons: 160,
    stockResearch: 120,
    emphasisFood: 34,
    emphasisShips: 33,
    emphasisResearch: 33,
  });
  const systemBeta = await ctx.db.insert("gal_systems", {
    gameId,
    systemKey: "beta",
    name: "Beta Reach",
    x: 420 * mapScale,
    y: 260 * mapScale,
    resourceRichness: 0.6,
    baseProductivity: seedBaseProductivity(0.6),
    isHomeworld: true,
    ownerEmpireId: null,
    population: 50_000_000,
    stockFood: 5_000,
    stockWeapons: 160,
    stockResearch: 120,
    emphasisFood: 34,
    emphasisShips: 33,
    emphasisResearch: 33,
  });
  const systemGamma = await ctx.db.insert("gal_systems", {
    gameId,
    systemKey: "gamma",
    name: "Gamma Drift",
    x: 260 * mapScale,
    y: 420 * mapScale,
    resourceRichness: 0.7,
    baseProductivity: seedBaseProductivity(0.7),
    isHomeworld: false,
    ownerEmpireId: null,
    population: 5_000_000,
    stockFood: 2_400,
    stockWeapons: 70,
    stockResearch: 85,
    emphasisFood: 34,
    emphasisShips: 33,
    emphasisResearch: 33,
  });

  const pausedNow = Date.now();
  const auroraEmpireId = await ctx.db.insert("emp_states", {
    gameId,
    empireKey: "aurora",
    name: "Aurora Combine",
    colorHex: pickEmpireCatalogColorHex("aurora", "#22d3ee", empireColorPrefLookup),
    treasury: 1200,
    foodStockpile: 500,
    population: 50_000_000,
    stability: 0.85,
    isCollapsed: false,
    homeSystemId: systemAlpha,
    techLevel: 0,
    researchPool: 0,
    insolvencyTurns: 0,
    pauseBudgetSeconds: 20,
    lastPauseRefreshAt: pausedNow,
    empireTaxRate: 0.05,
  });
  const ironEmpireId = await ctx.db.insert("emp_states", {
    gameId,
    empireKey: "iron",
    name: "Iron Dominion",
    colorHex: pickEmpireCatalogColorHex("iron", "#FF0000", empireColorPrefLookup),
    treasury: 1200,
    foodStockpile: 500,
    population: 50_000_000,
    stability: 0.85,
    isCollapsed: false,
    homeSystemId: systemBeta,
    techLevel: 0,
    researchPool: 0,
    insolvencyTurns: 0,
    pauseBudgetSeconds: 20,
    lastPauseRefreshAt: pausedNow,
    empireTaxRate: 0.05,
  });

  await ctx.db.patch("gal_systems", systemAlpha, { ownerEmpireId: auroraEmpireId });
  await ctx.db.patch("gal_systems", systemBeta, { ownerEmpireId: ironEmpireId });

  await ctx.db.insert("gal_links", {
    gameId,
    fromSystemId: systemAlpha,
    toSystemId: systemGamma,
    distance: 7,
    travelCost: 14,
  });
  await ctx.db.insert("gal_links", {
    gameId,
    fromSystemId: systemGamma,
    toSystemId: systemBeta,
    distance: 6,
    travelCost: 12,
  });

  await ctx.db.insert("emp_system_holdings", {
    gameId,
    empireId: auroraEmpireId,
    systemId: systemAlpha,
    taxRate: 0.18,
    productionModifier: 1.1,
    unrest: 0.05,
  });
  await ctx.db.insert("emp_system_holdings", {
    gameId,
    empireId: ironEmpireId,
    systemId: systemBeta,
    taxRate: 0.2,
    productionModifier: 1.05,
    unrest: 0.06,
  });

  await ctx.db.insert("flt_fleets", {
    gameId,
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
    gameId,
    empireId: ironEmpireId,
    fleetKey: "iron-1",
    name: "Iron Vanguard",
    strength: 100,
    originSystemId: systemBeta,
    destinationSystemId: null,
    etaTurn: null,
    status: "idle",
  });

  await seedNpcTraderIdentitiesForGame(ctx, gameId);

  return {
    systems: 3,
    empires: 2,
    mapKey,
  };
}
