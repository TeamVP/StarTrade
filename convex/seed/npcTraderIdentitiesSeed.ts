import type { MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { NPC_TRADER_CATALOG, NPC_TRADER_CATALOG_SIZE } from "./npcTraderCatalog";

/** Idempotent: inserts the 32 catalog NPC rows if this game has none yet. */
export async function seedNpcTraderIdentitiesForGame(
  ctx: MutationCtx,
  gameId: Id<"sim_games">,
): Promise<{ inserted: number }> {
  const existing = await ctx.db
    .query("sim_trader_identities")
    .withIndex("by_gameId", (q) => q.eq("gameId", gameId))
    .take(1);
  if (existing.length > 0) {
    return { inserted: 0 };
  }

  let inserted = 0;
  for (let i = 0; i < NPC_TRADER_CATALOG_SIZE; i++) {
    const entry = NPC_TRADER_CATALOG[i];
    await ctx.db.insert("sim_trader_identities", {
      gameId,
      catalogKey: entry.catalogKey,
      kind: "npc",
      displayName: entry.displayName,
      affiliation: entry.affiliation,
      slotOrder: i,
      state: "inactive",
      treasury: 0,
      userId: null,
    });
    inserted++;
  }
  return { inserted };
}
