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

export const listColonyShipsForGame = query({
  args: { gameId: v.id("sim_games"), limit: v.number() },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("col_colony_ships")
      .withIndex("by_gameId", (q) => q.eq("gameId", args.gameId))
      .take(args.limit);
    return await attachActorMetadata(ctx, args.gameId, rows);
  },
});

/** Colony ships for the caller's empire (or all, if game admin). */
export const listMyColonyShips = query({
  args: { gameId: v.id("sim_games"), limit: v.number() },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return [];

    const binding = await ctx.db
      .query("usr_game_roles")
      .withIndex("by_gameId_and_userId", (q) =>
        q.eq("gameId", args.gameId).eq("userId", userId),
      )
      .unique();

    if (binding === null || !binding.isActive || binding.role === "observer") {
      return [];
    }

    const game = await ctx.db.get("sim_games", args.gameId);
    const runtimeVersion = resolveGameRuntimeVersion(game?.runtimeVersion);

    if (binding.role === "admin") {
      const rows = await ctx.db
        .query("col_colony_ships")
        .withIndex("by_gameId", (q) => q.eq("gameId", args.gameId))
        .take(args.limit);
      return await attachActorMetadata(ctx, args.gameId, rows);
    }

    const empireId = await resolveControlledEmpireIdForRole(ctx, {
      gameId: args.gameId,
      runtimeVersion,
      userId,
      role: binding.role,
      empireId: binding.empireId,
    });
    if (empireId === null) return [];

    const rows = await ctx.db
      .query("col_colony_ships")
      .withIndex("by_gameId_and_empireId", (q) =>
        q.eq("gameId", args.gameId).eq("empireId", empireId),
      )
      .take(args.limit);
    return await attachActorMetadata(ctx, args.gameId, rows);
  },
});
