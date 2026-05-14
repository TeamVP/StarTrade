import type { MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { seedSelectedNpcEmpires } from "./npcEmpireSeed";
import { seedNpcTraderIdentitiesForGame } from "./npcTraderIdentitiesSeed";
import { pickEmpireCatalogColorHex } from "./empireColorPrefLookup";
import { chooseBalancedHomeworldPlacement } from "./homeworldPlacement";
import {
  V1_SPIRAL_LANE_KEYS,
  V1_SPIRAL_SYSTEMS,
  V1_SPIRAL_SYSTEM_COUNT,
  makeSpiralLinkMetrics,
} from "./v1Spiral";
import { STAR_SYSTEM_STARTING_TREASURY } from "../sim/economy/constants";

function seedBaseProductivity(resourceRichness: number): number {
  return Math.max(1, Math.min(10, Math.round(3 + resourceRichness * 7)));
}

export async function spiralInsertSystemsRange(
  ctx: MutationCtx,
  gameId: Id<"sim_games">,
  startIdx: number,
  endIdx: number,
): Promise<void> {
  const slice = V1_SPIRAL_SYSTEMS.slice(startIdx, endIdx);
  for (const s of slice) {
    await ctx.db.insert("gal_systems", {
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
  }
}

async function buildKeyToIdAndCoords(
  ctx: MutationCtx,
  gameId: Id<"sim_games">,
): Promise<{
  keyToId: Map<string, Id<"gal_systems">>;
  coordByKey: Map<string, { x: number; y: number }>;
}> {
  const rows = await ctx.db
    .query("gal_systems")
    .withIndex("by_gameId", (q) => q.eq("gameId", gameId))
    .collect();
  if (rows.length !== V1_SPIRAL_SYSTEM_COUNT) {
    throw new Error(
      `v1-spiral: expected ${V1_SPIRAL_SYSTEM_COUNT} systems in DB for homeworlds/links, found ${rows.length}`,
    );
  }
  const keyToId = new Map<string, Id<"gal_systems">>();
  const coordByKey = new Map<string, { x: number; y: number }>();
  for (const row of rows) {
    keyToId.set(row.systemKey, row._id);
    coordByKey.set(row.systemKey, { x: row.x, y: row.y });
  }
  if (keyToId.size !== V1_SPIRAL_SYSTEM_COUNT) {
    throw new Error(
      `v1-spiral: duplicate or invalid systemKey in gal_systems (unique keys ${keyToId.size}, expected ${V1_SPIRAL_SYSTEM_COUNT})`,
    );
  }
  for (const s of V1_SPIRAL_SYSTEMS) {
    if (!keyToId.has(s.key)) {
      throw new Error(`v1-spiral: missing DB row for system key ${s.key}`);
    }
  }
  return { keyToId, coordByKey };
}

export type SpiralFinishArgs = {
  gameId: Id<"sim_games">;
  mapKey: string;
  gameSeed: string;
  npcEmpireKeys: readonly string[];
  empireColorPrefLookup: Record<string, string>;
};

/** Empires, homeworld patches, NPC empires, holdings, fleets (not links or traders). */
export async function spiralFinishEmpiresNpcHoldingsFleets(
  ctx: MutationCtx,
  args: SpiralFinishArgs,
): Promise<number> {
  const { gameId, mapKey, gameSeed, npcEmpireKeys, empireColorPrefLookup } = args;
  const { keyToId, coordByKey } = await buildKeyToIdAndCoords(ctx, gameId);

  const homeworldPlacement = chooseBalancedHomeworldPlacement({
    systems: V1_SPIRAL_SYSTEMS,
    count: 2 + npcEmpireKeys.length,
    seed: `${mapKey}:${gameSeed}:${npcEmpireKeys.join(",")}`,
  });
  const [auroraHomeKey, ironHomeKey, ...npcHomeKeys] =
    homeworldPlacement.homeworldKeys;

  if (auroraHomeKey === undefined || ironHomeKey === undefined) {
    throw new Error("v1-spiral seed: missing balanced homeworld placement.");
  }

  const systemAurora = keyToId.get(auroraHomeKey);
  const systemIron = keyToId.get(ironHomeKey);
  if (systemAurora === undefined || systemIron === undefined) {
    throw new Error("v1-spiral seed: homeworld IDs missing.");
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
    systems: V1_SPIRAL_SYSTEMS,
    keyToId,
    coordByKey,
    pausedNow,
    empireColorPrefLookup,
    homeworldKeys: npcHomeKeys,
  });

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
  return npcEmpireCount;
}

export async function spiralInsertLinksRange(
  ctx: MutationCtx,
  gameId: Id<"sim_games">,
  linkStartIdx: number,
  linkEndIdx: number,
): Promise<void> {
  const { keyToId, coordByKey } = await buildKeyToIdAndCoords(ctx, gameId);
  const lanes = V1_SPIRAL_LANE_KEYS.slice(linkStartIdx, linkEndIdx);
  for (const lane of lanes) {
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
      throw new Error(`v1-spiral seed: unknown lane ${lane.fromKey}-${lane.toKey}`);
    }
    const { distance, travelCost } = makeSpiralLinkMetrics(a.x, a.y, b.x, b.y);
    await ctx.db.insert("gal_links", {
      gameId,
      fromSystemId: fromId,
      toSystemId: toId,
      distance,
      travelCost,
    });
  }
}

/** Single-mutation seed (Convex ~1s limit); use batched action for production. */
export async function seedV1SpiralMap(
  ctx: MutationCtx,
  gameId: Id<"sim_games">,
  mapKey: string,
  gameSeed: string,
  npcEmpireKeys: readonly string[],
  empireColorPrefLookup: Record<string, string> = {},
): Promise<{ systems: number; empires: number; mapKey: string }> {
  await spiralInsertSystemsRange(ctx, gameId, 0, V1_SPIRAL_SYSTEMS.length);
  const npcEmpireCount = await spiralFinishEmpiresNpcHoldingsFleets(ctx, {
    gameId,
    mapKey,
    gameSeed,
    npcEmpireKeys,
    empireColorPrefLookup,
  });
  await spiralInsertLinksRange(ctx, gameId, 0, V1_SPIRAL_LANE_KEYS.length);
  await seedNpcTraderIdentitiesForGame(ctx, gameId);

  return {
    systems: V1_SPIRAL_SYSTEMS.length,
    empires: 2 + npcEmpireCount,
    mapKey,
  };
}
