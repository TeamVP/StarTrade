import { query } from "../_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import { gameUsesTraderEconomy, loadGameWithResolvedMode } from "../sim/gameMode";

function resolveGameRuntimeVersion(
  runtimeVersion: "v1_empire" | "v2_game_actor" | null | undefined,
): "v1_empire" | "v2_game_actor" {
  return runtimeVersion ?? "v1_empire";
}

/**
 * Full-game economy snapshot for map admins: empires, systems with holdings + idle fleet totals,
 * latest turn market prices.
 */
export const adminEconomySnapshot = query({
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

    if (binding === null || !binding.isActive || binding.role !== "admin") {
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

    const empires = await ctx.db
      .query("emp_states")
      .withIndex("by_gameId", (q) => q.eq("gameId", args.gameId))
      .take(64);

    const systemsRaw = await ctx.db
      .query("gal_systems")
      .withIndex("by_gameId", (q) => q.eq("gameId", args.gameId))
      .take(256);

    const holdings = await ctx.db
      .query("emp_system_holdings")
      .withIndex("by_gameId", (q) => q.eq("gameId", args.gameId))
      .take(512);

    const runtimeVersion = resolveGameRuntimeVersion(game.runtimeVersion);
    const actors =
      runtimeVersion === "v2_game_actor"
        ? await ctx.db
            .query("sim_game_actors")
            .withIndex("by_gameId", (q) => q.eq("gameId", args.gameId))
            .collect()
        : [];
    const actorById = new Map(actors.map((actor) => [actor._id, actor] as const));
    const actorByLegacyEmpireId = new Map(
      actors
        .filter((actor) => actor.legacyEmpireId !== null)
        .map((actor) => [actor.legacyEmpireId!, actor] as const),
    );

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
    for (const h of holdings) {
      const actor =
        (h.gameActorId !== undefined ? actorById.get(h.gameActorId) : null) ??
        actorByLegacyEmpireId.get(h.empireId) ??
        null;
      holdingBySystemId.set(h.systemId, {
        ...h,
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

    const systems = systemsRaw.map((system) => {
      const ownerActor =
        (system.ownerGameActorId !== undefined ? actorById.get(system.ownerGameActorId) : null) ??
        (system.ownerEmpireId !== null ? actorByLegacyEmpireId.get(system.ownerEmpireId) : null) ??
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

    const empiresWithActors = empires.map((empire) => {
      const actor = actorByLegacyEmpireId.get(empire._id) ?? null;
      return {
        ...empire,
        runtimeVersion,
        actorId: actor?._id ?? null,
        actorSlotNumber: actor?.slotNumber ?? null,
        actorLabel: actor?.factionLabelSnapshot ?? null,
        actorDisplayName: actor?.displayNameSnapshot ?? null,
      };
    });

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
      empires: empiresWithActors,
      systems,
      marketSnapshots: marketSnapshots.map((row) => ({
        commodity: row.commodity,
        unitPrice: row.unitPrice,
        volume: row.volume,
      })),
    };
  },
});
