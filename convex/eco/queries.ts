import { query, type QueryCtx } from "../_generated/server";
import { v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";

async function attachCaptainFields(
  ctx: QueryCtx,
  rows: Doc<"eco_bg_traders">[],
): Promise<
  Array<
    Doc<"eco_bg_traders"> & {
      captainDisplayName: string | null;
      captainAffiliation: string | null;
      operatorKind: "npc" | "player" | "unknown";
    }
  >
> {
  const idSet = new Set<string>();
  for (const t of rows) {
    if (t.traderIdentityId != null) idSet.add(t.traderIdentityId);
  }
  const map = new Map<
    string,
    { displayName: string; affiliation: string; kind: "npc" | "player" }
  >();
  for (const id of idSet) {
    const doc = await ctx.db.get("sim_trader_identities", id as Id<"sim_trader_identities">);
    if (doc !== null) {
      map.set(id, {
        displayName: doc.displayName,
        affiliation: doc.affiliation,
        kind: doc.kind,
      });
    }
  }
  return rows.map((t) => {
    const cap = t.traderIdentityId != null ? map.get(t.traderIdentityId) : undefined;
    return {
      ...t,
      captainDisplayName: cap?.displayName ?? null,
      captainAffiliation: cap?.affiliation ?? null,
      operatorKind: cap === undefined ? ("unknown" as const) : cap.kind,
    };
  });
}

export const getCommodityHistory = query({
  args: {
    gameId: v.id("sim_games"),
    commodity: v.string(),
    limit: v.number(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("eco_market_snapshots")
      .withIndex("by_gameId_and_commodity", (q) =>
        q.eq("gameId", args.gameId).eq("commodity", args.commodity),
      )
      .order("desc")
      .take(args.limit);
  },
});

/**
 * Returns all background traders currently in transit for a game.
 * Useful for map overlays showing active trade routes.
 */
export const listActiveTraders = query({
  args: { gameId: v.id("sim_games") },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("eco_bg_traders")
      .withIndex("by_gameId_and_status", (q) =>
        q.eq("gameId", args.gameId).eq("status", "enRoute"),
      )
      .take(64);
    return await attachCaptainFields(ctx, rows);
  },
});

/**
 * Returns recently completed trader deliveries for a game (last N delivered records).
 */
export const listRecentDeliveries = query({
  args: { gameId: v.id("sim_games"), limit: v.number() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("eco_bg_traders")
      .withIndex("by_gameId_and_status", (q) =>
        q.eq("gameId", args.gameId).eq("status", "delivered"),
      )
      .order("desc")
      .take(args.limit);
  },
});

/**
 * Returns all systems with their current food prices for a game.
 * Only systems with a known foodPrice (owned, economy has run) are included.
 */
export const listSystemFoodPrices = query({
  args: { gameId: v.id("sim_games") },
  handler: async (ctx, args) => {
    const systems = await ctx.db
      .query("gal_systems")
      .withIndex("by_gameId", (q) => q.eq("gameId", args.gameId))
      .take(256);

    return systems
      .filter((s) => s.foodPrice !== undefined)
      .map((s) => ({
        systemId: s._id,
        name: s.name,
        foodPrice: s.foodPrice as number,
        stockFood: s.stockFood ?? 0,
        population: s.population ?? 0,
        ownerEmpireId: s.ownerEmpireId,
      }));
  },
});

/**
 * Returns traders inbound to a specific system — useful for showing the
 * "incoming relief ships" in a system detail panel.
 */
export const listInboundTraders = query({
  args: { gameId: v.id("sim_games"), systemId: v.id("gal_systems") },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("eco_bg_traders")
      .withIndex("by_gameId_and_destinationSystemId_and_status", (q) =>
        q
          .eq("gameId", args.gameId)
          .eq("destinationSystemId", args.systemId)
          .eq("status", "enRoute"),
      )
      .take(16);
    return await attachCaptainFields(ctx, rows);
  },
});

/** Named trader roster for a game (NPC pool + future player rows). */
export const listNpcTraderIdentities = query({
  args: { gameId: v.id("sim_games") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("sim_trader_identities")
      .withIndex("by_gameId", (q) => q.eq("gameId", args.gameId))
      .take(64);
  },
});

/**
 * Returns all traders (any status) for a game with system names resolved —
 * used by the /traders admin screen.
 * Returns up to `limit` traders ordered newest-first, plus a system map
 * for use in the spawn form.
 */
export const listTradersWithDetails = query({
  args: {
    gameId: v.id("sim_games"),
    statusFilter: v.union(
      v.literal("enRoute"),
      v.literal("delivered"),
      v.literal("cancelled"),
      v.literal("all"),
    ),
    limit: v.number(),
  },
  handler: async (ctx, args) => {
    let traders: Doc<"eco_bg_traders">[];
    const statusFilter = args.statusFilter;

    if (statusFilter === "all") {
      const statuses = ["enRoute", "delivered", "cancelled"] as const;
      const batches = await Promise.all(
        statuses.map((status) =>
          ctx.db
            .query("eco_bg_traders")
            .withIndex("by_gameId_and_status", (q) =>
              q.eq("gameId", args.gameId).eq("status", status),
            )
            .order("desc")
            .take(args.limit),
        ),
      );
      traders = batches
        .flat()
        .sort((a, b) => b._creationTime - a._creationTime)
        .slice(0, args.limit);
    } else {
      traders = await ctx.db
        .query("eco_bg_traders")
        .withIndex("by_gameId_and_status", (q) =>
          q.eq("gameId", args.gameId).eq("status", statusFilter),
        )
        .order("desc")
        .take(args.limit);
    }

    // Resolve origin + destination system names and owner IDs.
    const systemIdSet = new Set<string>();
    for (const t of traders) {
      systemIdSet.add(t.originSystemId);
      systemIdSet.add(t.destinationSystemId);
    }

    const systemMap = new Map<string, { name: string; ownerEmpireId: string | null }>();
    for (const id of systemIdSet) {
      const sys = await ctx.db.get("gal_systems", id as Id<"gal_systems">);
      if (sys !== null) {
        systemMap.set(id, { name: sys.name, ownerEmpireId: sys.ownerEmpireId });
      }
    }

    const idSet = new Set<string>();
    for (const t of traders) {
      if (t.traderIdentityId != null) idSet.add(t.traderIdentityId);
    }
    const captainMap = new Map<string, { displayName: string; affiliation: string; kind: "npc" | "player" }>();
    for (const id of idSet) {
      const doc = await ctx.db.get("sim_trader_identities", id as Id<"sim_trader_identities">);
      if (doc !== null) {
        captainMap.set(id, {
          displayName: doc.displayName,
          affiliation: doc.affiliation,
          kind: doc.kind,
        });
      }
    }

    const enriched = traders.map((t) => {
      const origin = systemMap.get(t.originSystemId) ?? { name: "Unknown", ownerEmpireId: null };
      const dest = systemMap.get(t.destinationSystemId) ?? { name: "Unknown", ownerEmpireId: null };
      const turnsRemaining = t.etaTurn - t.dispatchedTurn;
      const totalShipCost = t.shipHireCostPerTurn * t.travelTurns;
      const cap = t.traderIdentityId != null ? captainMap.get(t.traderIdentityId) : undefined;
      return {
        ...t,
        originName: origin.name,
        destName: dest.name,
        turnsRemaining,
        totalShipCost,
        captainDisplayName: cap?.displayName ?? null,
        captainAffiliation: cap?.affiliation ?? null,
        operatorKind: cap === undefined ? ("unknown" as const) : cap.kind,
      };
    });

    // All systems in the game for the spawn form dropdowns.
    const allSystems = await ctx.db
      .query("gal_systems")
      .withIndex("by_gameId", (q) => q.eq("gameId", args.gameId))
      .take(256);

    const systemList = allSystems.map((s) => ({
      _id: s._id,
      name: s.name,
      ownerEmpireId: s.ownerEmpireId,
      foodPrice: s.foodPrice,
      stockFood: s.stockFood,
    }));

    return { traders: enriched, systems: systemList };
  },
});
