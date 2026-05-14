import type { MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { seedSelectedNpcEmpires } from "./npcEmpireSeed";
import { seedNpcTraderIdentitiesForGame } from "./npcTraderIdentitiesSeed";
import { pickEmpireCatalogColorHex } from "./empireColorPrefLookup";
import { chooseBalancedHomeworldPlacement } from "./homeworldPlacement";
import {
  V1_TWENTY_LANE_KEYS,
  V1_TWENTY_SYSTEMS,
  makeLinkMetrics,
} from "./v1Twenty";
import { STAR_SYSTEM_STARTING_TREASURY } from "../sim/economy/constants";

function seedBaseProductivity(resourceRichness: number): number {
  return Math.max(1, Math.min(10, Math.round(3 + resourceRichness * 7)));
}

export async function seedV1TwentyMap(
  ctx: MutationCtx,
  gameId: Id<"sim_games">,
  mapKey: string,
  gameSeed: string,
  npcEmpireKeys: readonly string[],
  empireColorPrefLookup: Record<string, string> = {},
): Promise<{ systems: number; empires: number; mapKey: string }> {
  const keyToId = new Map<string, Id<"gal_systems">>();
  const coordByKey = new Map<string, { x: number; y: number }>();
  const homeworldPlacement = chooseBalancedHomeworldPlacement({
    systems: V1_TWENTY_SYSTEMS,
    count: 2 + npcEmpireKeys.length,
    seed: `${mapKey}:${gameSeed}:${npcEmpireKeys.join(",")}`,
  });
  const [auroraHomeKey, ironHomeKey, ...npcHomeKeys] =
    homeworldPlacement.homeworldKeys;

  if (auroraHomeKey === undefined || ironHomeKey === undefined) {
    throw new Error("v1-twenty seed: missing balanced homeworld placement.");
  }

  for (const s of V1_TWENTY_SYSTEMS) {
    const id = await ctx.db.insert("gal_systems", {
      gameId,
      systemKey: s.key,
      name: s.name,
      x: s.x,
      y: s.y,
      resourceRichness: s.resourceRichness,
      baseProductivity: seedBaseProductivity(s.resourceRichness),
      isHomeworld: false,
      ownerEmpireId: null,
      population: 5_000_000,
      stockFood: 2_400,
      stockWeapons: 70,
      stockResearch: 85,
      localTreasury: STAR_SYSTEM_STARTING_TREASURY,
      emphasisFood: 34,
      emphasisShips: 33,
      emphasisResearch: 33,
    });
    keyToId.set(s.key, id);
    coordByKey.set(s.key, { x: s.x, y: s.y });
  }

  const systemAurora = keyToId.get(auroraHomeKey);
  const systemIron = keyToId.get(ironHomeKey);
  if (systemAurora === undefined || systemIron === undefined) {
    throw new Error("v1-twenty seed: homeworld IDs missing.");
  }

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
    homeSystemId: systemAurora,
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
    homeSystemId: systemIron,
    techLevel: 0,
    researchPool: 0,
    insolvencyTurns: 0,
    pauseBudgetSeconds: 20,
    lastPauseRefreshAt: pausedNow,
    empireTaxRate: 0.05,
  });

  await ctx.db.patch("gal_systems", systemAurora, {
    ownerEmpireId: auroraEmpireId,
    isHomeworld: true,
    population: 50_000_000,
    stockFood: 5_000,
    stockWeapons: 160,
    stockResearch: 120,
  });
  await ctx.db.patch("gal_systems", systemIron, {
    ownerEmpireId: ironEmpireId,
    isHomeworld: true,
    population: 50_000_000,
    stockFood: 5_000,
    stockWeapons: 160,
    stockResearch: 120,
  });

  const npcEmpireCount = await seedSelectedNpcEmpires(ctx, {
    gameId,
    npcEmpireKeys,
    systems: V1_TWENTY_SYSTEMS,
    keyToId,
    coordByKey,
    pausedNow,
    empireColorPrefLookup,
    homeworldKeys: npcHomeKeys,
  });

  for (const lane of V1_TWENTY_LANE_KEYS) {
    const fromId = keyToId.get(lane.fromKey);
    const toId = keyToId.get(lane.toKey);
    const a = coordByKey.get(lane.fromKey);
    const b = coordByKey.get(lane.toKey);
    if (
      fromId === undefined ||
      toId === undefined ||
      a === undefined ||
      b === undefined
    ) {
      throw new Error(`v1-twenty seed: unknown lane ${lane.fromKey}–${lane.toKey}`);
    }
    const { distance, travelCost } = makeLinkMetrics(a.x, a.y, b.x, b.y);
    await ctx.db.insert("gal_links", {
      gameId,
      fromSystemId: fromId,
      toSystemId: toId,
      distance,
      travelCost,
    });
  }

  await ctx.db.insert("emp_system_holdings", {
    gameId,
    empireId: auroraEmpireId,
    systemId: systemAurora,
    taxRate: 0.18,
    productionModifier: 1.1,
    unrest: 0.05,
  });
  await ctx.db.insert("emp_system_holdings", {
    gameId,
    empireId: ironEmpireId,
    systemId: systemIron,
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
    originSystemId: systemAurora,
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
    originSystemId: systemIron,
    destinationSystemId: null,
    etaTurn: null,
    status: "idle",
  });

  await seedNpcTraderIdentitiesForGame(ctx, gameId);

  return {
    systems: V1_TWENTY_SYSTEMS.length,
    empires: 2 + npcEmpireCount,
    mapKey,
  };
}
