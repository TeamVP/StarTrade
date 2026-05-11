import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx } from "../../_generated/server";
import { seedNpcTraderIdentitiesForGame } from "../../seed/npcTraderIdentitiesSeed";
import {
  NPC_TRADER_BANKRUPTCY_BELOW,
  NPC_TRADER_STARTING_TREASURY,
} from "./constants";
import { NPC_TRADER_CATALOG_SIZE } from "../../seed/npcTraderCatalog";

export async function ensureNpcTraderIdentitiesForGame(
  ctx: MutationCtx,
  gameId: Id<"sim_games">,
): Promise<void> {
  await seedNpcTraderIdentitiesForGame(ctx, gameId);
}

async function loadIdentitiesForGame(
  ctx: MutationCtx,
  gameId: Id<"sim_games">,
): Promise<Doc<"sim_trader_identities">[]> {
  return await ctx.db
    .query("sim_trader_identities")
    .withIndex("by_gameId", (q) => q.eq("gameId", gameId))
    .take(64);
}

function isSolventNpc(row: Doc<"sim_trader_identities">): boolean {
  return row.kind === "npc" && row.state === "active" && row.treasury >= NPC_TRADER_BANKRUPTCY_BELOW;
}

/**
 * Keeps up to min(traderMaxActive, pool size) solvent NPC identities in `active` state
 * by promoting `inactive` rows (each receives starting treasury).
 */
export async function refillActiveNpcIdentities(
  ctx: MutationCtx,
  params: { gameId: Id<"sim_games">; traderMaxActive: number },
): Promise<void> {
  const target = Math.min(NPC_TRADER_CATALOG_SIZE, Math.max(0, Math.floor(params.traderMaxActive)));
  if (target === 0) return;

  const rows = await loadIdentitiesForGame(ctx, params.gameId);
  const solvent = rows.filter(isSolventNpc).length;
  let need = target - solvent;
  if (need <= 0) return;

  const inactive = rows
    .filter((r) => r.kind === "npc" && r.state === "inactive")
    .sort((a, b) => a.slotOrder - b.slotOrder);

  for (const row of inactive) {
    if (need <= 0) break;
    await ctx.db.patch("sim_trader_identities", row._id, {
      state: "active",
      treasury: NPC_TRADER_STARTING_TREASURY,
    });
    need--;
  }
}

export async function npcIdentityHasEnRouteVoyage(
  ctx: MutationCtx,
  gameId: Id<"sim_games">,
  traderIdentityId: Id<"sim_trader_identities">,
): Promise<boolean> {
  const voyages = await ctx.db
    .query("eco_bg_traders")
    .withIndex("by_gameId_and_status", (q) =>
      q.eq("gameId", gameId).eq("status", "enRoute"),
    )
    .take(128);
  return voyages.some((v) => v.traderIdentityId === traderIdentityId);
}

export async function pickNpcIdentityForNewVoyage(
  ctx: MutationCtx,
  gameId: Id<"sim_games">,
): Promise<Id<"sim_trader_identities"> | null> {
  const rows = await loadIdentitiesForGame(ctx, gameId);
  const candidates = rows
    .filter(isSolventNpc)
    .sort((a, b) => a.slotOrder - b.slotOrder);
  for (const row of candidates) {
    if (!(await npcIdentityHasEnRouteVoyage(ctx, gameId, row._id))) {
      return row._id;
    }
  }
  return null;
}

export async function applyVoyageProfitToNpcIdentity(
  ctx: MutationCtx,
  params: {
    gameId: Id<"sim_games">;
    traderIdentityId: Id<"sim_trader_identities"> | null | undefined;
    profitRounded: number;
    traderMaxActive: number;
  },
): Promise<void> {
  if (params.traderIdentityId == null) return;
  const row = await ctx.db.get("sim_trader_identities", params.traderIdentityId);
  if (row === null || row.kind !== "npc") return;

  const nextTreasury = row.treasury + params.profitRounded;
  if (nextTreasury < NPC_TRADER_BANKRUPTCY_BELOW) {
    await ctx.db.patch("sim_trader_identities", row._id, {
      treasury: nextTreasury,
      state: "bankrupt",
    });
  } else {
    await ctx.db.patch("sim_trader_identities", row._id, {
      treasury: nextTreasury,
    });
  }

  await refillActiveNpcIdentities(ctx, {
    gameId: params.gameId,
    traderMaxActive: params.traderMaxActive,
  });
}
