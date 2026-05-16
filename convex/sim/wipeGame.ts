import type { MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import type { WipeGamePhase } from "./wipeGamePhases";
import { WIPE_GAME_PHASES } from "./wipeGamePhases";

export { WIPE_GAME_PHASES, type WipeGamePhase } from "./wipeGamePhases";

/**
 * Max documents to read+delete per scheduled wipe step. Keeps each mutation under Convex
 * read limits even when many tables still have rows.
 */
export const WIPE_MUTATION_BATCH_SIZE = 100;

/**
 * Deletes up to {@link WIPE_MUTATION_BATCH_SIZE} documents for the given phase.
 * @returns `"more"` if the phase may still have rows; `"done"` if this phase is finished.
 */
export async function wipeGamePhaseBatch(
  ctx: MutationCtx,
  gameId: Id<"sim_games">,
  phase: WipeGamePhase,
): Promise<"more" | "done"> {
  const n = WIPE_MUTATION_BATCH_SIZE;
  switch (phase) {
    case "flt_orders": {
      const batch = await ctx.db
        .query("flt_orders")
        .withIndex("by_gameId_and_turnNumber", (q) => q.eq("gameId", gameId))
        .take(n);
      if (batch.length === 0) return "done";
      for (const doc of batch) {
        await ctx.db.delete("flt_orders", doc._id);
      }
      return batch.length === n ? "more" : "done";
    }
    case "flt_garrison_routes": {
      const batch = await ctx.db
        .query("flt_garrison_routes")
        .withIndex("by_gameId", (q) => q.eq("gameId", gameId))
        .take(n);
      if (batch.length === 0) return "done";
      for (const doc of batch) {
        await ctx.db.delete("flt_garrison_routes", doc._id);
      }
      return batch.length === n ? "more" : "done";
    }
    case "trd_runs": {
      const batch = await ctx.db
        .query("trd_runs")
        .withIndex("by_gameId_and_turnNumber", (q) => q.eq("gameId", gameId))
        .take(n);
      if (batch.length === 0) return "done";
      for (const doc of batch) {
        await ctx.db.delete("trd_runs", doc._id);
      }
      return batch.length === n ? "more" : "done";
    }
    case "trd_charters": {
      const batch = await ctx.db
        .query("trd_charters")
        .withIndex("by_gameId_and_status", (q) => q.eq("gameId", gameId))
        .take(n);
      if (batch.length === 0) return "done";
      for (const doc of batch) {
        await ctx.db.delete("trd_charters", doc._id);
      }
      return batch.length === n ? "more" : "done";
    }
    case "eco_market_snapshots": {
      const batch = await ctx.db
        .query("eco_market_snapshots")
        .withIndex("by_gameId_and_turnNumber", (q) => q.eq("gameId", gameId))
        .take(n);
      if (batch.length === 0) return "done";
      for (const doc of batch) {
        await ctx.db.delete("eco_market_snapshots", doc._id);
      }
      return batch.length === n ? "more" : "done";
    }
    case "eco_system_outputs": {
      const batch = await ctx.db
        .query("eco_system_outputs")
        .withIndex("by_gameId_and_systemId", (q) => q.eq("gameId", gameId))
        .take(n);
      if (batch.length === 0) return "done";
      for (const doc of batch) {
        await ctx.db.delete("eco_system_outputs", doc._id);
      }
      return batch.length === n ? "more" : "done";
    }
    case "eco_bg_traders": {
      for (const status of ["enRoute", "delivered", "cancelled"] as const) {
        const batch = await ctx.db
          .query("eco_bg_traders")
          .withIndex("by_gameId_and_status", (q) =>
            q.eq("gameId", gameId).eq("status", status),
          )
          .take(n);
        if (batch.length === 0) continue;
        for (const doc of batch) {
          await ctx.db.delete("eco_bg_traders", doc._id);
        }
        return "more";
      }
      return "done";
    }
    case "sim_trader_identities": {
      const batch = await ctx.db
        .query("sim_trader_identities")
        .withIndex("by_gameId", (q) => q.eq("gameId", gameId))
        .take(n);
      if (batch.length === 0) return "done";
      for (const doc of batch) {
        await ctx.db.delete("sim_trader_identities", doc._id);
      }
      return batch.length === n ? "more" : "done";
    }
    case "sim_game_settings": {
      const row = await ctx.db
        .query("sim_game_settings")
        .withIndex("by_gameId", (q) => q.eq("gameId", gameId))
        .unique();
      if (row !== null) {
        await ctx.db.delete("sim_game_settings", row._id);
      }
      return "done";
    }
    case "cmb_battles": {
      const batch = await ctx.db
        .query("cmb_battles")
        .withIndex("by_gameId", (q) => q.eq("gameId", gameId))
        .take(n);
      if (batch.length === 0) return "done";
      for (const doc of batch) {
        await ctx.db.delete("cmb_battles", doc._id);
      }
      return batch.length === n ? "more" : "done";
    }
    case "col_colony_ships": {
      const batch = await ctx.db
        .query("col_colony_ships")
        .withIndex("by_gameId", (q) => q.eq("gameId", gameId))
        .take(n);
      if (batch.length === 0) return "done";
      for (const doc of batch) {
        await ctx.db.delete("col_colony_ships", doc._id);
      }
      return batch.length === n ? "more" : "done";
    }
    case "flt_fleets": {
      const batch = await ctx.db
        .query("flt_fleets")
        .withIndex("by_gameId", (q) => q.eq("gameId", gameId))
        .take(n);
      if (batch.length === 0) return "done";
      for (const doc of batch) {
        await ctx.db.delete("flt_fleets", doc._id);
      }
      return batch.length === n ? "more" : "done";
    }
    case "emp_system_holdings": {
      const batch = await ctx.db
        .query("emp_system_holdings")
        .withIndex("by_gameId_and_empireId", (q) => q.eq("gameId", gameId))
        .take(n);
      if (batch.length === 0) return "done";
      for (const doc of batch) {
        await ctx.db.delete("emp_system_holdings", doc._id);
      }
      return batch.length === n ? "more" : "done";
    }
    case "gal_links": {
      const batch = await ctx.db
        .query("gal_links")
        .withIndex("by_gameId", (q) => q.eq("gameId", gameId))
        .take(n);
      if (batch.length === 0) return "done";
      for (const doc of batch) {
        await ctx.db.delete("gal_links", doc._id);
      }
      return batch.length === n ? "more" : "done";
    }
    case "gal_systems": {
      const batch = await ctx.db
        .query("gal_systems")
        .withIndex("by_gameId", (q) => q.eq("gameId", gameId))
        .take(n);
      if (batch.length === 0) return "done";
      for (const doc of batch) {
        await ctx.db.delete("gal_systems", doc._id);
      }
      return batch.length === n ? "more" : "done";
    }
    case "emp_states": {
      const batch = await ctx.db
        .query("emp_states")
        .withIndex("by_gameId", (q) => q.eq("gameId", gameId))
        .take(n);
      if (batch.length === 0) return "done";
      for (const doc of batch) {
        await ctx.db.delete("emp_states", doc._id);
      }
      return batch.length === n ? "more" : "done";
    }
    case "sim_events": {
      const batch = await ctx.db
        .query("sim_events")
        .withIndex("by_gameId", (q) => q.eq("gameId", gameId))
        .take(n);
      if (batch.length === 0) return "done";
      for (const doc of batch) {
        await ctx.db.delete("sim_events", doc._id);
      }
      return batch.length === n ? "more" : "done";
    }
    case "sim_turn_preparations": {
      const batch = await ctx.db
        .query("sim_turn_preparations")
        .withIndex("by_gameId", (q) => q.eq("gameId", gameId))
        .take(n);
      if (batch.length === 0) return "done";
      for (const doc of batch) {
        await ctx.db.delete("sim_turn_preparations", doc._id);
      }
      return batch.length === n ? "more" : "done";
    }
    case "sim_turns": {
      const batch = await ctx.db
        .query("sim_turns")
        .withIndex("by_gameId", (q) => q.eq("gameId", gameId))
        .take(n);
      if (batch.length === 0) return "done";
      for (const doc of batch) {
        await ctx.db.delete("sim_turns", doc._id);
      }
      return batch.length === n ? "more" : "done";
    }
    case "usr_game_roles": {
      const batch = await ctx.db
        .query("usr_game_roles")
        .withIndex("by_gameId_and_role", (q) => q.eq("gameId", gameId))
        .take(n);
      if (batch.length === 0) return "done";
      for (const doc of batch) {
        await ctx.db.delete("usr_game_roles", doc._id);
      }
      return batch.length === n ? "more" : "done";
    }
    default: {
      const _exhaustive: never = phase;
      return _exhaustive;
    }
  }
}

export function wipePhaseAtIndex(index: number): WipeGamePhase | null {
  if (index < 0 || index >= WIPE_GAME_PHASES.length) return null;
  return WIPE_GAME_PHASES[index] ?? null;
}
