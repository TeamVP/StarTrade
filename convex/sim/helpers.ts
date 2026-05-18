import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

export { GAME_ABANDONMENT_INACTIVITY_MS } from "./finalization";
export {
  nextGameAbandonmentEligibleAt,
  recordGameTurnResolved,
  touchGameMeaningfulActivity,
} from "./finalization";

/** True when the sim is in play (turns can matter) but not in lobby or finished. */
export function gameAllowsPlayerActions(
  status: Doc<"sim_games">["status"],
): boolean {
  return status === "running" || status === "paused";
}

export async function assertGameAdmin(
  ctx: MutationCtx,
  gameId: Id<"sim_games">,
  userId: Id<"users">,
): Promise<void> {
  const binding = await ctx.db
    .query("usr_game_roles")
    .withIndex("by_gameId_and_userId", (q) =>
      q.eq("gameId", gameId).eq("userId", userId),
    )
    .unique();

  if (binding === null || !binding.isActive || binding.role !== "admin") {
    throw new Error("Only game admins can perform this action.");
  }
}

export async function assertCanStepTurn(
  ctx: MutationCtx,
  gameId: Id<"sim_games">,
  userId: Id<"users">,
): Promise<void> {
  const binding = await ctx.db
    .query("usr_game_roles")
    .withIndex("by_gameId_and_userId", (q) =>
      q.eq("gameId", gameId).eq("userId", userId),
    )
    .unique();

  if (binding === null || !binding.isActive) {
    throw new Error("You are not a member of this game.");
  }
  if (binding.role !== "admin" && binding.role !== "empire") {
    throw new Error("Only admins and empire players can advance the turn.");
  }
}

/** Same membership/role rules as {@link assertCanStepTurn} — pause/resume matches who may step. */
export async function assertCanPauseOrResumeGame(
  ctx: MutationCtx,
  gameId: Id<"sim_games">,
  userId: Id<"users">,
): Promise<void> {
  const binding = await ctx.db
    .query("usr_game_roles")
    .withIndex("by_gameId_and_userId", (q) =>
      q.eq("gameId", gameId).eq("userId", userId),
    )
    .unique();

  if (binding === null || !binding.isActive) {
    throw new Error("You are not a member of this game.");
  }
  if (binding.role !== "admin" && binding.role !== "empire") {
    throw new Error(
      "Only game admins and empire players can pause or resume the clock.",
    );
  }
}

async function resolveControlledEmpireAccess(
  ctx: MutationCtx,
  params: {
    gameId: Id<"sim_games">;
    userId: Id<"users">;
  },
): Promise<{
  isAdmin: boolean;
  controlledEmpireId: Id<"emp_states"> | null;
  controlledGameActorId: Id<"sim_game_actors"> | null;
}> {
  const binding = await ctx.db
    .query("usr_game_roles")
    .withIndex("by_gameId_and_userId", (q) =>
      q.eq("gameId", params.gameId).eq("userId", params.userId),
    )
    .unique();

  if (binding === null || !binding.isActive) {
    throw new Error("You are not an active member of this game.");
  }
  if (binding.role === "admin") {
    return { isAdmin: true, controlledEmpireId: null, controlledGameActorId: null };
  }
  if (binding.role !== "empire") {
    return { isAdmin: false, controlledEmpireId: null, controlledGameActorId: null };
  }
  if (binding.empireId !== null) {
    return {
      isAdmin: false,
      controlledEmpireId: binding.empireId,
      controlledGameActorId: null,
    };
  }

  const game = await ctx.db.get("sim_games", params.gameId);
  const runtimeVersion = game?.runtimeVersion ?? "v1_empire";
  if (runtimeVersion !== "v2_game_actor") {
    return { isAdmin: false, controlledEmpireId: null, controlledGameActorId: null };
  }

  const actor = await ctx.db
    .query("sim_game_actors")
    .withIndex("by_gameId_and_controllerUserId", (q) =>
      q.eq("gameId", params.gameId).eq("controllerUserId", params.userId),
    )
    .unique();
  return {
    isAdmin: false,
    controlledEmpireId: actor?.legacyEmpireId ?? null,
    controlledGameActorId: actor?._id ?? null,
  };
}

/** Same rules as fleet/system orders: active membership, running/paused game, admin or owning empire. */
export async function assertMayAdjustGalaxySystemEmphasis(
  ctx: MutationCtx,
  params: {
    gameId: Id<"sim_games">;
    userId: Id<"users">;
    systemId: Id<"gal_systems">;
  },
): Promise<Doc<"gal_systems">> {
  const game = await ctx.db.get("sim_games", params.gameId);
  if (game === null) {
    throw new Error("Game not found.");
  }
  if (!gameAllowsPlayerActions(game.status)) {
    throw new Error(
      "Production sliders can only be changed while the game is running or paused.",
    );
  }

  const system = await ctx.db.get("gal_systems", params.systemId);
  if (system === null || system.gameId !== params.gameId) {
    throw new Error("System not found in this game.");
  }

  const { isAdmin, controlledEmpireId, controlledGameActorId } =
    await resolveControlledEmpireAccess(ctx, {
    gameId: params.gameId,
    userId: params.userId,
  });
  const isOwner =
    (system.ownerGameActorId !== undefined &&
      controlledGameActorId !== null &&
      system.ownerGameActorId === controlledGameActorId) ||
    (system.ownerEmpireId !== null && controlledEmpireId === system.ownerEmpireId);

  if (!isAdmin && !isOwner) {
    if (system.ownerEmpireId === null) {
      throw new Error(
        "This system has no colony — assign ownership before setting production emphasis (admins only until then).",
      );
    }
    throw new Error(
      "Only the empire that owns this colony — or a game admin — can change production sliders.",
    );
  }

  return system;
}

/** Admin or the empire’s own players may adjust empire-wide economy policy (e.g. tax rate). */
export async function assertMayAdjustEmpireEconomy(
  ctx: MutationCtx,
  params: {
    gameId: Id<"sim_games">;
    userId: Id<"users">;
    empireId: Id<"emp_states">;
    gameActorId?: Id<"sim_game_actors">;
  },
): Promise<Doc<"emp_states">> {
  const game = await ctx.db.get("sim_games", params.gameId);
  if (game === null) {
    throw new Error("Game not found.");
  }
  if (!gameAllowsPlayerActions(game.status)) {
    throw new Error(
      "Empire economy settings can only be changed while the game is running or paused.",
    );
  }

  const empire = await ctx.db.get("emp_states", params.empireId);
  if (empire === null || empire.gameId !== params.gameId) {
    throw new Error("Empire not found in this game.");
  }

  if (params.gameActorId !== undefined) {
    const actor = await ctx.db.get("sim_game_actors", params.gameActorId);
    if (actor === null || actor.gameId !== params.gameId) {
      throw new Error("Game actor not found in this game.");
    }
    if (actor.legacyEmpireId !== params.empireId) {
      throw new Error("Game actor does not match the selected empire.");
    }
  }

  const { isAdmin, controlledEmpireId, controlledGameActorId } =
    await resolveControlledEmpireAccess(ctx, {
    gameId: params.gameId,
    userId: params.userId,
  });
  const isOwner =
    controlledEmpireId === params.empireId ||
    (params.gameActorId !== undefined && controlledGameActorId === params.gameActorId);

  if (!isAdmin && !isOwner) {
    throw new Error(
      "Only that empire’s players — or a game admin — can change empire economy settings.",
    );
  }

  return empire;
}
