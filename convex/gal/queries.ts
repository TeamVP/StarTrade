import { query, type QueryCtx } from "../_generated/server";
import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import type { Doc, Id } from "../_generated/dataModel";

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

async function resolveControlledEmpireIdForRole(
  ctx: QueryCtx,
  params: {
    gameId: Id<"sim_games">;
    runtimeVersion: "v1_empire" | "v2_game_actor";
    userId: Id<"users">;
    role: "observer" | "empire" | "trader" | "admin";
    empireId: Id<"emp_states"> | null;
  },
): Promise<Id<"emp_states"> | null> {
  if (params.role !== "empire") {
    return null;
  }
  if (params.empireId !== null) {
    return params.empireId;
  }
  if (params.runtimeVersion !== "v2_game_actor") {
    return null;
  }

  const actor = await ctx.db
    .query("sim_game_actors")
    .withIndex("by_gameId_and_controllerUserId", (q) =>
      q.eq("gameId", params.gameId).eq("controllerUserId", params.userId),
    )
    .unique();
  return actor?.legacyEmpireId ?? null;
}

async function attachActorMetadata<
  T extends { empireId: Id<"emp_states">; gameActorId?: Id<"sim_game_actors"> | null },
>(
  ctx: QueryCtx,
  gameId: Id<"sim_games">,
  rows: T[],
) {
  const game = await ctx.db.get("sim_games", gameId);
  const runtimeVersion = resolveGameRuntimeVersion(game?.runtimeVersion);
  if (runtimeVersion !== "v2_game_actor") {
    return rows.map((row) => ({
      ...row,
      runtimeVersion,
      actorId: null,
      actorSlotNumber: null,
      actorLabel: null,
      actorDisplayName: null,
    }));
  }

  const { actorById, actorByLegacyEmpireId } = await listActorsForGame(ctx, gameId);
  return rows.map((row) => {
    const actor =
      (row.gameActorId !== undefined && row.gameActorId !== null
        ? actorById.get(row.gameActorId)
        : null) ??
      actorByLegacyEmpireId.get(row.empireId) ??
      null;
    return {
      ...row,
      runtimeVersion,
      actorId: actor?._id ?? null,
      actorSlotNumber: actor?.slotNumber ?? null,
      actorLabel: actor?.factionLabelSnapshot ?? null,
      actorDisplayName: actor?.displayNameSnapshot ?? null,
    };
  });
}

export const listSystems = query({
  args: { gameId: v.id("sim_games"), limit: v.number() },
  handler: async (ctx, args) => {
    const game = await ctx.db.get("sim_games", args.gameId);
    const runtimeVersion = resolveGameRuntimeVersion(game?.runtimeVersion);
    const systems = await ctx.db
      .query("gal_systems")
      .withIndex("by_gameId", (q) => q.eq("gameId", args.gameId))
      .take(args.limit);
    if (runtimeVersion !== "v2_game_actor") {
      return systems.map((system) => ({
        ...system,
        runtimeVersion,
        ownerActorId: null,
        ownerActorSlotNumber: null,
        ownerActorLabel: null,
        ownerActorDisplayName: null,
      }));
    }

    const { actorById, actorByLegacyEmpireId } = await listActorsForGame(ctx, args.gameId);
    return systems.map((system) => {
      const actor =
        (system.ownerGameActorId !== undefined
          ? actorById.get(system.ownerGameActorId)
          : null) ??
        (system.ownerEmpireId !== null ? actorByLegacyEmpireId.get(system.ownerEmpireId) : null) ??
        null;
      return {
        ...system,
        runtimeVersion,
        ownerActorId: actor?._id ?? null,
        ownerActorSlotNumber: actor?.slotNumber ?? null,
        ownerActorLabel: actor?.factionLabelSnapshot ?? null,
        ownerActorDisplayName: actor?.displayNameSnapshot ?? null,
      };
    });
  },
});

export const listLinksFromSystem = query({
  args: { gameId: v.id("sim_games"), fromSystemId: v.id("gal_systems") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("gal_links")
      .withIndex("by_gameId_and_fromSystemId", (q) =>
        q.eq("gameId", args.gameId).eq("fromSystemId", args.fromSystemId),
      )
      .take(256);
  },
});

export const listLinks = query({
  args: { gameId: v.id("sim_games"), limit: v.number() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("gal_links")
      .withIndex("by_gameId", (q) => q.eq("gameId", args.gameId))
      .take(args.limit);
  },
});

export const listMyPriorityStars = query({
  args: {
    gameId: v.id("sim_games"),
    empireId: v.optional(v.id("emp_states")),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return [];

    const game = await ctx.db.get("sim_games", args.gameId);
    const runtimeVersion = resolveGameRuntimeVersion(game?.runtimeVersion);

    const binding = await ctx.db
      .query("usr_game_roles")
      .withIndex("by_gameId_and_userId", (q) =>
        q.eq("gameId", args.gameId).eq("userId", userId),
      )
      .unique();
    if (binding === null || !binding.isActive) {
      return [];
    }

    let empireId = await resolveControlledEmpireIdForRole(ctx, {
      gameId: args.gameId,
      runtimeVersion,
      userId,
      role: binding.role,
      empireId: binding.empireId,
    });
    if (binding.role === "admin" && args.empireId !== undefined) {
      const empire = await ctx.db.get("emp_states", args.empireId);
      if (empire === null || empire.gameId !== args.gameId) return [];
      empireId = empire._id;
    }
    if (empireId === null) return [];

    const rows = await ctx.db
      .query("emp_priority_stars")
      .withIndex("by_gameId_and_empireId", (q) =>
        q.eq("gameId", args.gameId).eq("empireId", empireId),
      )
      .take(256);
    return await attachActorMetadata(ctx, args.gameId, rows);
  },
});
