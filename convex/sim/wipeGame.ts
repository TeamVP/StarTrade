import type { MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";

/** Deletes all rows scoped to a game, in dependency-safe order. */
export async function wipeAllDocumentsForGame(
  ctx: MutationCtx,
  gameId: Id<"sim_games">,
): Promise<void> {
  await drainFltOrders(ctx, gameId);
  await drainFltGarrisonRoutes(ctx, gameId);
  await drainTrdRuns(ctx, gameId);
  await drainTrdCharters(ctx, gameId);
  await drainEcoMarketSnapshots(ctx, gameId);
  await drainEcoSystemOutputs(ctx, gameId);
  await drainEcoBgTraders(ctx, gameId);
  await drainSimTraderIdentities(ctx, gameId);
  await drainSimGameSettings(ctx, gameId);
  await drainCmbBattles(ctx, gameId);
  await drainFltFleets(ctx, gameId);
  await drainEmpSystemHoldings(ctx, gameId);
  await drainGalLinks(ctx, gameId);
  await drainGalSystems(ctx, gameId);
  await drainEmpStates(ctx, gameId);
  await drainSimEvents(ctx, gameId);
  await drainSimTurns(ctx, gameId);
  await drainUsrGameRoles(ctx, gameId);
}

async function drainFltOrders(ctx: MutationCtx, gameId: Id<"sim_games">): Promise<void> {
  for (;;) {
    const batch = await ctx.db
      .query("flt_orders")
      .withIndex("by_gameId_and_turnNumber", (q) => q.eq("gameId", gameId))
      .take(256);
    if (batch.length === 0) return;
    for (const doc of batch) {
      await ctx.db.delete("flt_orders", doc._id);
    }
  }
}

async function drainFltGarrisonRoutes(
  ctx: MutationCtx,
  gameId: Id<"sim_games">,
): Promise<void> {
  for (;;) {
    const batch = await ctx.db
      .query("flt_garrison_routes")
      .withIndex("by_gameId", (q) => q.eq("gameId", gameId))
      .take(256);
    if (batch.length === 0) return;
    for (const doc of batch) {
      await ctx.db.delete("flt_garrison_routes", doc._id);
    }
  }
}

async function drainTrdRuns(ctx: MutationCtx, gameId: Id<"sim_games">): Promise<void> {
  for (;;) {
    const batch = await ctx.db
      .query("trd_runs")
      .withIndex("by_gameId_and_turnNumber", (q) => q.eq("gameId", gameId))
      .take(256);
    if (batch.length === 0) return;
    for (const doc of batch) {
      await ctx.db.delete("trd_runs", doc._id);
    }
  }
}

async function drainTrdCharters(ctx: MutationCtx, gameId: Id<"sim_games">): Promise<void> {
  for (;;) {
    const batch = await ctx.db
      .query("trd_charters")
      .withIndex("by_gameId_and_status", (q) => q.eq("gameId", gameId))
      .take(256);
    if (batch.length === 0) return;
    for (const doc of batch) {
      await ctx.db.delete("trd_charters", doc._id);
    }
  }
}

async function drainEcoMarketSnapshots(
  ctx: MutationCtx,
  gameId: Id<"sim_games">,
): Promise<void> {
  for (;;) {
    const batch = await ctx.db
      .query("eco_market_snapshots")
      .withIndex("by_gameId_and_turnNumber", (q) => q.eq("gameId", gameId))
      .take(256);
    if (batch.length === 0) return;
    for (const doc of batch) {
      await ctx.db.delete("eco_market_snapshots", doc._id);
    }
  }
}

async function drainEcoSystemOutputs(
  ctx: MutationCtx,
  gameId: Id<"sim_games">,
): Promise<void> {
  for (;;) {
    const batch = await ctx.db
      .query("eco_system_outputs")
      .withIndex("by_gameId_and_systemId", (q) => q.eq("gameId", gameId))
      .take(256);
    if (batch.length === 0) return;
    for (const doc of batch) {
      await ctx.db.delete("eco_system_outputs", doc._id);
    }
  }
}

async function drainEcoBgTraders(ctx: MutationCtx, gameId: Id<"sim_games">): Promise<void> {
  for (const status of ["enRoute", "delivered", "cancelled"] as const) {
    for (;;) {
      const batch = await ctx.db
        .query("eco_bg_traders")
        .withIndex("by_gameId_and_status", (q) =>
          q.eq("gameId", gameId).eq("status", status),
        )
        .take(256);
      if (batch.length === 0) break;
      for (const doc of batch) {
        await ctx.db.delete("eco_bg_traders", doc._id);
      }
    }
  }
}

async function drainSimTraderIdentities(
  ctx: MutationCtx,
  gameId: Id<"sim_games">,
): Promise<void> {
  for (;;) {
    const batch = await ctx.db
      .query("sim_trader_identities")
      .withIndex("by_gameId", (q) => q.eq("gameId", gameId))
      .take(256);
    if (batch.length === 0) return;
    for (const doc of batch) {
      await ctx.db.delete("sim_trader_identities", doc._id);
    }
  }
}

async function drainSimGameSettings(ctx: MutationCtx, gameId: Id<"sim_games">): Promise<void> {
  const row = await ctx.db
    .query("sim_game_settings")
    .withIndex("by_gameId", (q) => q.eq("gameId", gameId))
    .unique();
  if (row !== null) {
    await ctx.db.delete("sim_game_settings", row._id);
  }
}

async function drainCmbBattles(ctx: MutationCtx, gameId: Id<"sim_games">): Promise<void> {
  for (;;) {
    const batch = await ctx.db
      .query("cmb_battles")
      .withIndex("by_gameId", (q) => q.eq("gameId", gameId))
      .take(256);
    if (batch.length === 0) return;
    for (const doc of batch) {
      await ctx.db.delete("cmb_battles", doc._id);
    }
  }
}

async function drainFltFleets(ctx: MutationCtx, gameId: Id<"sim_games">): Promise<void> {
  for (;;) {
    const batch = await ctx.db
      .query("flt_fleets")
      .withIndex("by_gameId", (q) => q.eq("gameId", gameId))
      .take(256);
    if (batch.length === 0) return;
    for (const doc of batch) {
      await ctx.db.delete("flt_fleets", doc._id);
    }
  }
}

async function drainEmpSystemHoldings(
  ctx: MutationCtx,
  gameId: Id<"sim_games">,
): Promise<void> {
  for (;;) {
    const batch = await ctx.db
      .query("emp_system_holdings")
      .withIndex("by_gameId_and_empireId", (q) => q.eq("gameId", gameId))
      .take(256);
    if (batch.length === 0) return;
    for (const doc of batch) {
      await ctx.db.delete("emp_system_holdings", doc._id);
    }
  }
}

async function drainGalLinks(ctx: MutationCtx, gameId: Id<"sim_games">): Promise<void> {
  for (;;) {
    const batch = await ctx.db
      .query("gal_links")
      .withIndex("by_gameId", (q) => q.eq("gameId", gameId))
      .take(256);
    if (batch.length === 0) return;
    for (const doc of batch) {
      await ctx.db.delete("gal_links", doc._id);
    }
  }
}

async function drainGalSystems(ctx: MutationCtx, gameId: Id<"sim_games">): Promise<void> {
  for (;;) {
    const batch = await ctx.db
      .query("gal_systems")
      .withIndex("by_gameId", (q) => q.eq("gameId", gameId))
      .take(256);
    if (batch.length === 0) return;
    for (const doc of batch) {
      await ctx.db.delete("gal_systems", doc._id);
    }
  }
}

async function drainEmpStates(ctx: MutationCtx, gameId: Id<"sim_games">): Promise<void> {
  for (;;) {
    const batch = await ctx.db
      .query("emp_states")
      .withIndex("by_gameId", (q) => q.eq("gameId", gameId))
      .take(256);
    if (batch.length === 0) return;
    for (const doc of batch) {
      await ctx.db.delete("emp_states", doc._id);
    }
  }
}

async function drainSimEvents(ctx: MutationCtx, gameId: Id<"sim_games">): Promise<void> {
  for (;;) {
    const batch = await ctx.db
      .query("sim_events")
      .withIndex("by_gameId", (q) => q.eq("gameId", gameId))
      .take(256);
    if (batch.length === 0) return;
    for (const doc of batch) {
      await ctx.db.delete("sim_events", doc._id);
    }
  }
}

async function drainSimTurns(ctx: MutationCtx, gameId: Id<"sim_games">): Promise<void> {
  for (;;) {
    const batch = await ctx.db
      .query("sim_turns")
      .withIndex("by_gameId", (q) => q.eq("gameId", gameId))
      .take(256);
    if (batch.length === 0) return;
    for (const doc of batch) {
      await ctx.db.delete("sim_turns", doc._id);
    }
  }
}

async function drainUsrGameRoles(ctx: MutationCtx, gameId: Id<"sim_games">): Promise<void> {
  for (;;) {
    const batch = await ctx.db
      .query("usr_game_roles")
      .withIndex("by_gameId_and_role", (q) => q.eq("gameId", gameId))
      .take(256);
    if (batch.length === 0) return;
    for (const doc of batch) {
      await ctx.db.delete("usr_game_roles", doc._id);
    }
  }
}
