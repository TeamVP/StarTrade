import type { MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { pickEmpireCatalogColorHex } from "./empireColorPrefLookup";
import { getAutomationStrategyByKey } from "../usr/automationStrategyCatalog";
import { getNpcEmpirePlayersForKeys } from "./npcEmpirePlayers";

type NpcHomeworldSeedSystem = {
  key: string;
  resourceRichness: number;
  isHomeworld: boolean;
  startingOwner: string;
};

type SeedNpcEmpiresArgs = {
  gameId: Id<"sim_games">;
  npcEmpireKeys: readonly string[];
  systems: readonly NpcHomeworldSeedSystem[];
  keyToId: ReadonlyMap<string, Id<"gal_systems">>;
  coordByKey: ReadonlyMap<string, { x: number; y: number }>;
  pausedNow: number;
  empireColorPrefLookup: Record<string, string>;
  homeworldKeys?: readonly string[];
};

function chooseNpcHomeworldKeys(
  count: number,
  systems: readonly NpcHomeworldSeedSystem[],
  coordByKey: ReadonlyMap<string, { x: number; y: number }>,
): string[] {
  const candidates = systems
    .filter((s) => !s.isHomeworld && s.startingOwner === "neutral")
    .filter((s) => coordByKey.has(s.key));
  const picked: string[] = [];

  while (picked.length < count) {
    let best: { key: string; score: number } | null = null;
    for (const candidate of candidates) {
      if (picked.includes(candidate.key)) continue;
      const pos = coordByKey.get(candidate.key);
      if (pos === undefined) continue;

      const nearestPickedDistance =
        picked.length === 0
          ? 500
          : Math.min(
              ...picked.map((key) => {
                const pickedPos = coordByKey.get(key);
                if (pickedPos === undefined) return 0;
                return Math.hypot(pos.x - pickedPos.x, pos.y - pickedPos.y);
              }),
            );
      const score = candidate.resourceRichness * 250 + nearestPickedDistance;
      if (best === null || score > best.score) {
        best = { key: candidate.key, score };
      }
    }

    if (best === null) break;
    picked.push(best.key);
  }

  if (picked.length < count) {
    throw new Error(
      `Not enough neutral systems to place ${count} NPC empires (found ${picked.length}).`,
    );
  }

  return picked;
}

export async function seedSelectedNpcEmpires(
  ctx: MutationCtx,
  args: SeedNpcEmpiresArgs,
): Promise<number> {
  const npcPlayers = await getNpcEmpirePlayersForKeys(ctx, args.npcEmpireKeys);
  if (npcPlayers.length === 0) {
    return 0;
  }

  const homeKeys =
    args.homeworldKeys ??
    chooseNpcHomeworldKeys(npcPlayers.length, args.systems, args.coordByKey);
  if (homeKeys.length < npcPlayers.length) {
    throw new Error(
      `NPC empire seed: expected ${npcPlayers.length} homeworlds, received ${homeKeys.length}.`,
    );
  }

  for (let i = 0; i < npcPlayers.length; i++) {
    const player = npcPlayers[i];
    const homeKey = homeKeys[i];
    const homeSystemId = args.keyToId.get(homeKey);
    if (homeSystemId === undefined) {
      throw new Error(`NPC empire seed: missing home system ${homeKey}.`);
    }

    const strategy =
      player.strategyLibraryKey === null
        ? null
        : await getAutomationStrategyByKey(ctx, player.strategyLibraryKey);

    const empireId = await ctx.db.insert("emp_states", {
      gameId: args.gameId,
      empireKey: `npc-${player.key}`,
      name: player.empireName,
      colorHex: pickEmpireCatalogColorHex(player.key, player.colorHex, args.empireColorPrefLookup),
      treasury: 900,
      foodStockpile: 420,
      population: 35_000_000,
      stability: 0.78,
      isCollapsed: false,
      homeSystemId,
      techLevel: 0,
      researchPool: 0,
      insolvencyTurns: 0,
      pauseBudgetSeconds: 20,
      lastPauseRefreshAt: args.pausedNow,
      empireTaxRate: 0.05,
      controller: "npc",
      npcPlayerKey: player.key,
      playerName: player.playerName,
      strategyJson: strategy?.strategyJson,
    });

    await ctx.db.patch("gal_systems", homeSystemId, {
      ownerEmpireId: empireId,
      isHomeworld: true,
      population: 35_000_000,
      stockFood: 4_200,
      stockWeapons: 120,
      stockResearch: 95,
    });

    await ctx.db.insert("emp_system_holdings", {
      gameId: args.gameId,
      empireId,
      systemId: homeSystemId,
      taxRate: 0.16,
      productionModifier: 1.02,
      unrest: 0.08,
    });

    await ctx.db.insert("flt_fleets", {
      gameId: args.gameId,
      empireId,
      fleetKey: `npc-${player.key}-1`,
      name: `${player.empireName} Patrol`,
      strength: 70,
      originSystemId: homeSystemId,
      destinationSystemId: null,
      etaTurn: null,
      status: "idle",
    });
  }

  return npcPlayers.length;
}
