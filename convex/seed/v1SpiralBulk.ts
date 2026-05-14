import { internalMutation } from "../_generated/server";
import { v } from "convex/values";
import { seedNpcTraderIdentitiesForGame } from "./npcTraderIdentitiesSeed";
import { loadEmpireColorPrefLookup } from "./empireColorPrefLookup";
import {
  spiralFinishEmpiresNpcHoldingsFleets,
  spiralInsertLinksRange,
  spiralInsertSystemsRange,
} from "./v1SpiralSeed";

const DELETE_BATCH = 80;

async function deleteBatch<T extends { _id: string }>(
  takeBatch: () => Promise<T[]>,
  del: (id: T["_id"]) => Promise<void>,
): Promise<void> {
  for (;;) {
    const batch = await takeBatch();
    if (batch.length === 0) return;
    for (const row of batch) {
      await del(row._id);
    }
    if (batch.length < DELETE_BATCH) return;
  }
}

/**
 * Clears galaxy + empire seed rows for this game so a spiral re-seed is idempotent.
 * Order matches dependency safety (fleets / holdings before empires, links before systems).
 */
export const spiralPurgeGalaxyRows = internalMutation({
  args: { gameId: v.id("sim_games") },
  handler: async (ctx, args) => {
    const { gameId } = args;

    await deleteBatch(
      () =>
        ctx.db
          .query("flt_garrison_routes")
          .withIndex("by_gameId", (q) => q.eq("gameId", gameId))
          .take(DELETE_BATCH),
      (id) => ctx.db.delete("flt_garrison_routes", id),
    );
    await deleteBatch(
      () =>
        ctx.db
          .query("flt_orders")
          .withIndex("by_gameId_and_turnNumber", (q) => q.eq("gameId", gameId))
          .take(DELETE_BATCH),
      (id) => ctx.db.delete("flt_orders", id),
    );
    await deleteBatch(
      () =>
        ctx.db
          .query("col_colony_ships")
          .withIndex("by_gameId", (q) => q.eq("gameId", gameId))
          .take(DELETE_BATCH),
      (id) => ctx.db.delete("col_colony_ships", id),
    );
    await deleteBatch(
      () =>
        ctx.db
          .query("flt_fleets")
          .withIndex("by_gameId", (q) => q.eq("gameId", gameId))
          .take(DELETE_BATCH),
      (id) => ctx.db.delete("flt_fleets", id),
    );
    await deleteBatch(
      () =>
        ctx.db
          .query("emp_system_holdings")
          .withIndex("by_gameId", (q) => q.eq("gameId", gameId))
          .take(DELETE_BATCH),
      (id) => ctx.db.delete("emp_system_holdings", id),
    );
    await deleteBatch(
      () =>
        ctx.db
          .query("gal_links")
          .withIndex("by_gameId", (q) => q.eq("gameId", gameId))
          .take(DELETE_BATCH),
      (id) => ctx.db.delete("gal_links", id),
    );
    await deleteBatch(
      () =>
        ctx.db
          .query("emp_states")
          .withIndex("by_gameId", (q) => q.eq("gameId", gameId))
          .take(DELETE_BATCH),
      (id) => ctx.db.delete("emp_states", id),
    );
    await deleteBatch(
      () =>
        ctx.db
          .query("sim_trader_identities")
          .withIndex("by_gameId", (q) => q.eq("gameId", gameId))
          .take(DELETE_BATCH),
      (id) => ctx.db.delete("sim_trader_identities", id),
    );
    await deleteBatch(
      () =>
        ctx.db
          .query("gal_systems")
          .withIndex("by_gameId", (q) => q.eq("gameId", gameId))
          .take(DELETE_BATCH),
      (id) => ctx.db.delete("gal_systems", id),
    );
    return null;
  },
});

export const spiralInsertSystemsSlice = internalMutation({
  args: {
    gameId: v.id("sim_games"),
    startIdx: v.number(),
    endIdx: v.number(),
  },
  handler: async (ctx, args) => {
    await spiralInsertSystemsRange(ctx, args.gameId, args.startIdx, args.endIdx);
    return null;
  },
});

export const spiralFinishPostSystems = internalMutation({
  args: {
    gameId: v.id("sim_games"),
    colorPrefsUserId: v.optional(v.id("users")),
  },
  handler: async (ctx, args) => {
    const game = await ctx.db.get("sim_games", args.gameId);
    if (game === null) throw new Error("spiralFinishPostSystems: game not found.");
    const empireColorPrefLookup = await loadEmpireColorPrefLookup(
      ctx,
      args.colorPrefsUserId ?? null,
    );
    await spiralFinishEmpiresNpcHoldingsFleets(ctx, {
      gameId: args.gameId,
      mapKey: game.mapKey,
      gameSeed: game.seed,
      npcEmpireKeys: game.npcEmpireKeys ?? [],
      empireColorPrefLookup,
    });
    return null;
  },
});

export const spiralInsertLinksSlice = internalMutation({
  args: {
    gameId: v.id("sim_games"),
    linkStartIdx: v.number(),
    linkEndIdx: v.number(),
  },
  handler: async (ctx, args) => {
    await spiralInsertLinksRange(
      ctx,
      args.gameId,
      args.linkStartIdx,
      args.linkEndIdx,
    );
    return null;
  },
});

export const spiralSeedTraders = internalMutation({
  args: { gameId: v.id("sim_games") },
  handler: async (ctx, args) => {
    await seedNpcTraderIdentitiesForGame(ctx, args.gameId);
    return null;
  },
});
