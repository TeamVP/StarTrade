import { query, type QueryCtx } from "../_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import { loadGameSettings } from "../sim/economy/gameSettings";
import { gameUsesTraderEconomy, loadGameWithResolvedMode } from "../sim/gameMode";

function resolveGameRuntimeVersion(
  runtimeVersion: "v1_empire" | "v2_game_actor" | null | undefined,
): "v1_empire" | "v2_game_actor" {
  return runtimeVersion ?? "v1_empire";
}

async function listActorsForGame(
  ctx: QueryCtx,
  gameId: Id<"sim_games">,
): Promise<{
  actorById: Map<Id<"sim_game_actors">, Doc<"sim_game_actors">>;
  actorByLegacyEmpireId: Map<Id<"emp_states">, Doc<"sim_game_actors">>;
}> {
  const actors: Doc<"sim_game_actors">[] = await ctx.db
    .query("sim_game_actors")
    .withIndex("by_gameId", (q) => q.eq("gameId", gameId))
    .collect();
  return {
    actorById: new Map(actors.map((actor) => [actor._id, actor] as const)),
    actorByLegacyEmpireId: new Map(
      actors
        .filter((actor) => actor.legacyEmpireId !== null)
        .map((actor) => [actor.legacyEmpireId!, actor] as const),
    ),
  };
}

export const getMyEconomySnapshot = query({
  args: { gameId: v.id("sim_games") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      return { kind: "unauthenticated" as const };
    }

    const binding = await ctx.db
      .query("usr_game_roles")
      .withIndex("by_gameId_and_userId", (q) =>
        q.eq("gameId", args.gameId).eq("userId", userId),
      )
      .unique();

    if (binding === null || !binding.isActive || binding.role !== "empire") {
      return { kind: "forbidden" as const };
    }

    const game = await loadGameWithResolvedMode(ctx, args.gameId);
    if (game === null) {
      return { kind: "not_found" as const };
    }

    if (!gameUsesTraderEconomy(game)) {
      return {
        kind: "disabled" as const,
        game: {
          _id: game._id,
          name: game.name,
          mode: game.mode ?? "conquest_core",
          status: game.status,
          currentTurn: game.currentTurn,
          mapKey: game.mapKey,
        },
      };
    }

    const runtimeVersion = resolveGameRuntimeVersion(game.runtimeVersion);
    const actorMaps =
      runtimeVersion === "v2_game_actor"
        ? await listActorsForGame(ctx, args.gameId)
        : { actorById: new Map(), actorByLegacyEmpireId: new Map() };

    let controlledEmpireId = binding.empireId;
    let controlledGameActorId: Id<"sim_game_actors"> | null = null;
    if (runtimeVersion === "v2_game_actor") {
      if (binding.empireId !== null) {
        controlledGameActorId =
          actorMaps.actorByLegacyEmpireId.get(binding.empireId)?._id ?? null;
      } else {
        const actor = await ctx.db
          .query("sim_game_actors")
          .withIndex("by_gameId_and_controllerUserId", (q) =>
            q.eq("gameId", args.gameId).eq("controllerUserId", userId),
          )
          .unique();
        controlledEmpireId = actor?.legacyEmpireId ?? null;
        controlledGameActorId = actor?._id ?? null;
      }
    }

    if (controlledEmpireId === null) {
      return { kind: "forbidden" as const };
    }

    const empire = await ctx.db.get("emp_states", controlledEmpireId);
    if (empire === null || empire.gameId !== args.gameId) {
      return { kind: "forbidden" as const };
    }

    const systemsRaw = await ctx.db
      .query("gal_systems")
      .withIndex("by_gameId", (q) => q.eq("gameId", args.gameId))
      .take(256);

    const ownedSystemsRaw = systemsRaw.filter((system) => {
      if (
        runtimeVersion === "v2_game_actor" &&
        controlledGameActorId !== null &&
        system.ownerGameActorId !== undefined
      ) {
        return system.ownerGameActorId === controlledGameActorId;
      }
      return system.ownerEmpireId === controlledEmpireId;
    });

    const ownedSystemIds = new Set(ownedSystemsRaw.map((system) => system._id));
    const holdings = (
      await ctx.db
        .query("emp_system_holdings")
        .withIndex("by_gameId", (q) => q.eq("gameId", args.gameId))
        .take(512)
    ).filter((holding) => ownedSystemIds.has(holding.systemId));

    const holdingBySystemId = new Map<
      Id<"gal_systems">,
      Doc<"emp_system_holdings"> & {
        runtimeVersion: "v1_empire" | "v2_game_actor";
        actorId: Id<"sim_game_actors"> | null;
        actorSlotNumber: number | null;
        actorLabel: string | null;
        actorDisplayName: string | null;
      }
    >();
    for (const holding of holdings) {
      const actor =
        (holding.gameActorId !== undefined
          ? actorMaps.actorById.get(holding.gameActorId)
          : null) ?? actorMaps.actorByLegacyEmpireId.get(holding.empireId) ?? null;
      holdingBySystemId.set(holding.systemId, {
        ...holding,
        runtimeVersion,
        actorId: actor?._id ?? null,
        actorSlotNumber: actor?.slotNumber ?? null,
        actorLabel: actor?.factionLabelSnapshot ?? null,
        actorDisplayName: actor?.displayNameSnapshot ?? null,
      });
    }

    const fleets = await ctx.db
      .query("flt_fleets")
      .withIndex("by_gameId", (q) => q.eq("gameId", args.gameId))
      .take(256);

    const idleStrengthBySystem = new Map<Id<"gal_systems">, number>();
    for (const fleet of fleets) {
      if (fleet.status !== "idle") continue;
      idleStrengthBySystem.set(
        fleet.originSystemId,
        (idleStrengthBySystem.get(fleet.originSystemId) ?? 0) + fleet.strength,
      );
    }

    const systems = ownedSystemsRaw.map((system) => {
      const ownerActor =
        (system.ownerGameActorId !== undefined
          ? actorMaps.actorById.get(system.ownerGameActorId)
          : null) ??
        (system.ownerEmpireId !== null
          ? actorMaps.actorByLegacyEmpireId.get(system.ownerEmpireId)
          : null) ??
        null;
      return {
        ...system,
        runtimeVersion,
        ownerActorId: ownerActor?._id ?? null,
        ownerActorSlotNumber: ownerActor?.slotNumber ?? null,
        ownerActorLabel: ownerActor?.factionLabelSnapshot ?? null,
        ownerActorDisplayName: ownerActor?.displayNameSnapshot ?? null,
        idleFleetStrength: idleStrengthBySystem.get(system._id) ?? 0,
        holding: holdingBySystemId.get(system._id) ?? null,
      };
    });

    const empireActor =
      (controlledGameActorId !== null
        ? actorMaps.actorById.get(controlledGameActorId)
        : null) ?? actorMaps.actorByLegacyEmpireId.get(empire._id) ?? null;

    const marketSnapshots = await ctx.db
      .query("eco_market_snapshots")
      .withIndex("by_gameId_and_turnNumber", (q) =>
        q.eq("gameId", args.gameId).eq("turnNumber", game.currentTurn),
      )
      .take(32);

    return {
      kind: "ok" as const,
      game: {
        _id: game._id,
        name: game.name,
        status: game.status,
        currentTurn: game.currentTurn,
        mapKey: game.mapKey,
      },
      empires: [
        {
          ...empire,
          runtimeVersion,
          actorId: empireActor?._id ?? null,
          actorSlotNumber: empireActor?.slotNumber ?? null,
          actorLabel: empireActor?.factionLabelSnapshot ?? null,
          actorDisplayName: empireActor?.displayNameSnapshot ?? null,
        },
      ],
      systems,
      marketSnapshots: marketSnapshots.map((row) => ({
        commodity: row.commodity,
        unitPrice: row.unitPrice,
        volume: row.volume,
      })),
    };
  },
});

function formatOwnerLabel(params: {
  runtimeVersion: "v1_empire" | "v2_game_actor";
  ownerEmpireId: Id<"emp_states"> | null;
  ownerGameActorId?: Id<"sim_game_actors">;
  actorById: Map<Id<"sim_game_actors">, Doc<"sim_game_actors">>;
  actorByLegacyEmpireId: Map<Id<"emp_states">, Doc<"sim_game_actors">>;
}): string {
  if (params.ownerEmpireId === null) {
    return "Independent";
  }
  if (params.runtimeVersion !== "v2_game_actor") {
    return "Owned";
  }
  const actor =
    (params.ownerGameActorId !== undefined
      ? params.actorById.get(params.ownerGameActorId)
      : null) ?? params.actorByLegacyEmpireId.get(params.ownerEmpireId) ?? null;
  if (actor === null) {
    return "Owned";
  }
  const actorName = actor.displayNameSnapshot ?? actor.factionLabelSnapshot;
  return `Actor ${actor.slotNumber}${actorName !== null ? ` · ${actorName}` : ""}`;
}

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

/**
 * Returns traders that should be visible on the galaxy map: voyages still in
 * transit plus ships that delivered during the current turn resolution. The
 * latter stay at the destination star until the next turn begins, avoiding a
 * visual pop before the ship reaches the center of the destination.
 */
export const listActiveTraders = query({
  args: { gameId: v.id("sim_games") },
  handler: async (ctx, args) => {
    const game = await loadGameWithResolvedMode(ctx, args.gameId);
    if (game === null) return [];
    if (!gameUsesTraderEconomy(game)) return [];

    const enRouteRows = await ctx.db
      .query("eco_bg_traders")
      .withIndex("by_gameId_and_status", (q) =>
        q.eq("gameId", args.gameId).eq("status", "enRoute"),
      )
      .take(64);

    const justDeliveredRows = (
      await ctx.db
        .query("eco_bg_traders")
        .withIndex("by_gameId_and_status", (q) =>
          q.eq("gameId", args.gameId).eq("status", "delivered"),
        )
        .order("desc")
        .take(64)
    ).filter((row) => row.deliveredTurn === game.currentTurn);

    const rows = [...enRouteRows, ...justDeliveredRows];
    return await attachCaptainFields(ctx, rows);
  },
});

/**
 * Empires and independent systems NPC background traders refuse to serve until the boycott lifts
 * (set when a buyer could not pay full delivery proceeds).
 */
export const listActiveTraderEmbargoes = query({
  args: { gameId: v.id("sim_games") },
  handler: async (ctx, args) => {
    const game = await loadGameWithResolvedMode(ctx, args.gameId);
    if (game === null) {
      return {
        currentTurn: 0,
        empires: [] as Array<{
          empireId: Id<"emp_states">;
          name: string;
          boycottEndsTurn: number;
          turnsRemaining: number;
        }>,
        unownedSystems: [] as Array<{
          systemId: Id<"gal_systems">;
          name: string;
          boycottEndsTurn: number;
          turnsRemaining: number;
        }>,
      };
    }
    if (!gameUsesTraderEconomy(game)) {
      return {
        currentTurn: game.currentTurn,
        empires: [] as Array<{
          empireId: Id<"emp_states">;
          name: string;
          boycottEndsTurn: number;
          turnsRemaining: number;
        }>,
        unownedSystems: [] as Array<{
          systemId: Id<"gal_systems">;
          name: string;
          boycottEndsTurn: number;
          turnsRemaining: number;
        }>,
      };
    }

    const currentTurn = game.currentTurn;

    const empires = await ctx.db
      .query("emp_states")
      .withIndex("by_gameId", (q) => q.eq("gameId", args.gameId))
      .collect();

    const embargoEmpires = empires
      .filter(
        (e) =>
          e.traderBoycottUntilTurn !== undefined && currentTurn < e.traderBoycottUntilTurn,
      )
      .map((e) => ({
        empireId: e._id,
        name: e.name,
        boycottEndsTurn: e.traderBoycottUntilTurn as number,
        turnsRemaining: (e.traderBoycottUntilTurn as number) - currentTurn,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    const systems = await ctx.db
      .query("gal_systems")
      .withIndex("by_gameId", (q) => q.eq("gameId", args.gameId))
      .take(512);

    const embargoSystems = systems
      .filter(
        (s) =>
          s.ownerEmpireId === null &&
          s.traderBoycottUntilTurn !== undefined &&
          currentTurn < s.traderBoycottUntilTurn,
      )
      .map((s) => ({
        systemId: s._id,
        name: s.name,
        boycottEndsTurn: s.traderBoycottUntilTurn as number,
        turnsRemaining: (s.traderBoycottUntilTurn as number) - currentTurn,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    return {
      currentTurn,
      empires: embargoEmpires,
      unownedSystems: embargoSystems,
    };
  },
});

/**
 * Returns all systems with their current food prices for a game.
 * Only systems with a known foodPrice (owned, economy has run) are included.
 */
export const listSystemFoodPrices = query({
  args: { gameId: v.id("sim_games") },
  handler: async (ctx, args) => {
    const game = await loadGameWithResolvedMode(ctx, args.gameId);
    if (game === null || !gameUsesTraderEconomy(game)) return [];
    const runtimeVersion = resolveGameRuntimeVersion(game.runtimeVersion);
    const actorMaps =
      runtimeVersion === "v2_game_actor"
        ? await listActorsForGame(ctx, args.gameId)
        : { actorById: new Map(), actorByLegacyEmpireId: new Map() };
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
        ownerLabel: formatOwnerLabel({
          runtimeVersion,
          ownerEmpireId: s.ownerEmpireId,
          ownerGameActorId: s.ownerGameActorId,
          actorById: actorMaps.actorById,
          actorByLegacyEmpireId: actorMaps.actorByLegacyEmpireId,
        }),
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
    const game = await loadGameWithResolvedMode(ctx, args.gameId);
    if (game === null || !gameUsesTraderEconomy(game)) return [];
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
    const game = await loadGameWithResolvedMode(ctx, args.gameId);
    if (game === null || !gameUsesTraderEconomy(game)) {
      return [];
    }
    return await ctx.db
      .query("sim_trader_identities")
      .withIndex("by_gameId", (q) => q.eq("gameId", args.gameId))
      .take(64);
  },
});

/** NPC merchant pool tuning shown on the /traders admin screen. */
export const getNpcTraderPoolSettings = query({
  args: { gameId: v.id("sim_games") },
  returns: v.object({
    traderHireChancePct: v.number(),
  }),
  handler: async (ctx, args) => {
    const game = await loadGameWithResolvedMode(ctx, args.gameId);
    if (game === null || !gameUsesTraderEconomy(game)) {
      return { traderHireChancePct: 0 };
    }
    const settings = await loadGameSettings(ctx, args.gameId);
    return { traderHireChancePct: settings.traderHireChancePct };
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
    statusFilter: v.union(v.literal("enRoute"), v.literal("delivered")),
    limit: v.number(),
  },
  handler: async (ctx, args) => {
    const game = await loadGameWithResolvedMode(ctx, args.gameId);
    const runtimeVersion = resolveGameRuntimeVersion(game?.runtimeVersion);
    const actorMaps =
      game !== null && runtimeVersion === "v2_game_actor"
        ? await listActorsForGame(ctx, args.gameId)
        : { actorById: new Map(), actorByLegacyEmpireId: new Map() };
    if (game === null || !gameUsesTraderEconomy(game)) {
      const allSystems = await ctx.db
        .query("gal_systems")
        .withIndex("by_gameId", (q) => q.eq("gameId", args.gameId))
        .take(256);
      return {
        traders: [],
        systems: allSystems.map((s) => ({
          _id: s._id,
          name: s.name,
          ownerEmpireId: s.ownerEmpireId,
          ownerLabel: formatOwnerLabel({
            runtimeVersion,
            ownerEmpireId: s.ownerEmpireId,
            ownerGameActorId: s.ownerGameActorId,
            actorById: actorMaps.actorById,
            actorByLegacyEmpireId: actorMaps.actorByLegacyEmpireId,
          }),
          foodPrice: s.foodPrice,
          stockFood: s.stockFood,
        })),
        traderDockingFee: 100,
      };
    }

    const traders = await ctx.db
      .query("eco_bg_traders")
      .withIndex("by_gameId_and_status", (q) =>
        q.eq("gameId", args.gameId).eq("status", args.statusFilter),
      )
      .order("desc")
      .take(args.limit);

    // Resolve origin + destination system names and owner IDs.
    const systemIdSet = new Set<string>();
    for (const t of traders) {
      systemIdSet.add(t.originSystemId);
      systemIdSet.add(t.destinationSystemId);
    }

    const systemMap = new Map<string, {
      name: string;
      ownerEmpireId: string | null;
      ownerLabel: string;
    }>();
    for (const id of systemIdSet) {
      const sys = await ctx.db.get("gal_systems", id as Id<"gal_systems">);
      if (sys !== null) {
        systemMap.set(id, {
          name: sys.name,
          ownerEmpireId: sys.ownerEmpireId,
          ownerLabel: formatOwnerLabel({
            runtimeVersion,
            ownerEmpireId: sys.ownerEmpireId,
            ownerGameActorId: sys.ownerGameActorId,
            actorById: actorMaps.actorById,
            actorByLegacyEmpireId: actorMaps.actorByLegacyEmpireId,
          }),
        });
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
      const origin =
        systemMap.get(t.originSystemId) ??
        ({ name: "Unknown", ownerEmpireId: null, ownerLabel: "Unknown" } as const);
      const dest =
        systemMap.get(t.destinationSystemId) ??
        ({ name: "Unknown", ownerEmpireId: null, ownerLabel: "Unknown" } as const);
      const turnsRemaining = t.etaTurn - t.dispatchedTurn;
      const totalShipCost = t.shipHireCostPerTurn * t.travelTurns;
      const cap = t.traderIdentityId != null ? captainMap.get(t.traderIdentityId) : undefined;
      return {
        ...t,
        originName: origin.name,
        originOwnerLabel: origin.ownerLabel,
        destName: dest.name,
        destOwnerLabel: dest.ownerLabel,
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
      ownerLabel: formatOwnerLabel({
        runtimeVersion,
        ownerEmpireId: s.ownerEmpireId,
        ownerGameActorId: s.ownerGameActorId,
        actorById: actorMaps.actorById,
        actorByLegacyEmpireId: actorMaps.actorByLegacyEmpireId,
      }),
      foodPrice: s.foodPrice,
      stockFood: s.stockFood,
    }));

    const settings = await loadGameSettings(ctx, args.gameId);
    return {
      traders: enriched,
      systems: systemList,
      traderDockingFee: settings.traderDockingCost,
    };
  },
});
