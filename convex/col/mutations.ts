import { mutation } from "../_generated/server";
import type { MutationCtx } from "../_generated/server";
import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import type { Doc, Id } from "../_generated/dataModel";
import { findLinkBetweenSystems } from "../gal/linkUtils";
import { travelTurnsFromLinkCost } from "../sim/fleetDispatch";
import { gameAllowsPlayerActions } from "../sim/helpers";
import { insertSimEvent } from "../sim/eventLog";
import { loadGameSettings } from "../sim/economy/gameSettings";
import { reconcileSystemHolding } from "../sim/systemHoldings";
import {
  clampPopulationPeople,
  POPULATION_MIN_INHABITED_PEOPLE,
} from "../sim/economy/population";
import {
  COLONY_NEW_WORLD_FOOD_BONUS_PER_TURN,
  COLONY_NEW_WORLD_STARTER_FOOD,
  COLONY_SHIP_POP_CARGO_PEOPLE,
} from "./constants";
import {
  computeColonyShipBuildCostShipPoints,
  defaultEmpireTaxRateForBuild,
  estimateHomeworldMaxShipsPerTurn,
} from "./colonyShipBuildCost";
import { validateColonyShipRouteDestinations } from "./routeValidation";
import { invalidateOpenTurnPreparation } from "../sim/turnPreparationInvalidation";

async function resolveControlledAccess(
  ctx: MutationCtx,
  params: { gameId: Id<"sim_games">; userId: Id<"users"> },
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
    throw new Error("You are not a member of this game.");
  }
  if (binding.role === "observer" || binding.role === "trader") {
    throw new Error("Only empire players or admins can use colony ships.");
  }
  if (binding.role === "admin") {
    return { isAdmin: true, controlledEmpireId: null, controlledGameActorId: null };
  }

  const game = await ctx.db.get("sim_games", params.gameId);
  if (game === null) {
    throw new Error("Game not found.");
  }
  const runtimeVersion = game.runtimeVersion ?? "v1_empire";
  if (runtimeVersion !== "v2_game_actor") {
    return {
      isAdmin: false,
      controlledEmpireId: binding.empireId,
      controlledGameActorId: null,
    };
  }

  const actor = await ctx.db
    .query("sim_game_actors")
    .withIndex("by_gameId_and_controllerUserId", (q) =>
      q.eq("gameId", params.gameId).eq("controllerUserId", params.userId),
    )
    .unique();
  return {
    isAdmin: false,
    controlledEmpireId: binding.empireId ?? actor?.legacyEmpireId ?? null,
    controlledGameActorId: actor?._id ?? null,
  };
}

async function assertGameAndMembership(
  ctx: MutationCtx,
  params: { gameId: Id<"sim_games">; userId: Id<"users"> },
): Promise<Doc<"sim_games">> {
  const game = await ctx.db.get("sim_games", params.gameId);
  if (game === null) throw new Error("Game not found.");
  if (!gameAllowsPlayerActions(game.status)) {
    throw new Error("Game must be running or paused.");
  }

  await resolveControlledAccess(ctx, params);
  return game;
}

async function assertEmpireControlsHomeworld(
  ctx: MutationCtx,
  params: {
    gameId: Id<"sim_games">;
    userId: Id<"users">;
    systemId: Id<"gal_systems">;
  },
): Promise<{
  system: Doc<"gal_systems">;
  empire: Doc<"emp_states">;
  access: {
    isAdmin: boolean;
    controlledEmpireId: Id<"emp_states"> | null;
    controlledGameActorId: Id<"sim_game_actors"> | null;
  };
}> {
  const game = await assertGameAndMembership(ctx, {
    gameId: params.gameId,
    userId: params.userId,
  });
  void game;

  const system = await ctx.db.get("gal_systems", params.systemId);
  if (system === null || system.gameId !== params.gameId) {
    throw new Error("System not found in this game.");
  }
  if (system.ownerEmpireId === null) {
    throw new Error("That system has no empire owner.");
  }

  const access = await resolveControlledAccess(ctx, {
    gameId: params.gameId,
    userId: params.userId,
  });
  const ownsSystem =
    access.controlledGameActorId !== null &&
    system.ownerGameActorId !== undefined &&
    system.ownerGameActorId !== null
      ? access.controlledGameActorId === system.ownerGameActorId
      : access.controlledEmpireId === system.ownerEmpireId;

  if (!access.isAdmin && !ownsSystem) {
    throw new Error("You do not control that system.");
  }

  const empire = await ctx.db.get("emp_states", system.ownerEmpireId);
  if (empire === null || empire.isCollapsed) {
    throw new Error("Empire not available.");
  }
  if (empire.homeSystemId === null || empire.homeSystemId !== system._id) {
    throw new Error("Colony ships can only be built at your homeworld.");
  }
  if (!system.isHomeworld) {
    throw new Error("Colony ships can only be built at a homeworld.");
  }

  return { system, empire, access };
}

async function assertControlsColonyShip(
  ctx: MutationCtx,
  params: {
    gameId: Id<"sim_games">;
    userId: Id<"users">;
    colonyShipId: Id<"col_colony_ships">;
  },
): Promise<{
  ship: Doc<"col_colony_ships">;
  access: {
    isAdmin: boolean;
    controlledEmpireId: Id<"emp_states"> | null;
    controlledGameActorId: Id<"sim_game_actors"> | null;
  };
}> {
  await assertGameAndMembership(ctx, {
    gameId: params.gameId,
    userId: params.userId,
  });

  const ship = await ctx.db.get("col_colony_ships", params.colonyShipId);
  if (ship === null || ship.gameId !== params.gameId) {
    throw new Error("Colony ship not found.");
  }

  const access = await resolveControlledAccess(ctx, {
    gameId: params.gameId,
    userId: params.userId,
  });
  const ownsShip =
    access.controlledGameActorId !== null &&
    ship.gameActorId !== undefined &&
    ship.gameActorId !== null
      ? access.controlledGameActorId === ship.gameActorId
      : access.controlledEmpireId === ship.empireId;

  if (!access.isAdmin && !ownsShip) {
    throw new Error("You cannot command this colony ship.");
  }

  return { ship, access };
}

async function assertGameActorMatchesEmpire(
  ctx: MutationCtx,
  params: {
    gameId: Id<"sim_games">;
    gameActorId: Id<"sim_game_actors">;
    empireId: Id<"emp_states">;
  },
): Promise<void> {
  const actor = await ctx.db.get("sim_game_actors", params.gameActorId);
  if (actor === null || actor.gameId !== params.gameId) {
    throw new Error("Game actor not found.");
  }
  if (actor.legacyEmpireId !== params.empireId) {
    throw new Error("Game actor does not match the controlled empire.");
  }
}

export const startColonyShipBuild = mutation({
  args: {
    gameId: v.id("sim_games"),
    gameActorId: v.optional(v.id("sim_game_actors")),
    systemId: v.id("gal_systems"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Authentication required.");

    const { system, empire } = await assertEmpireControlsHomeworld(ctx, {
      gameId: args.gameId,
      userId,
      systemId: args.systemId,
    });
    if (args.gameActorId !== undefined) {
      await assertGameActorMatchesEmpire(ctx, {
        gameId: args.gameId,
        gameActorId: args.gameActorId,
        empireId: empire._id,
      });
    }

    const idleHere = await ctx.db
      .query("col_colony_ships")
      .withIndex("by_gameId_and_originSystemId_and_status", (q) =>
        q
          .eq("gameId", args.gameId)
          .eq("originSystemId", system._id)
          .eq("status", "idle"),
      )
      .take(8);
    const oursIdle = idleHere.filter((s) => s.empireId === empire._id);
    if (oursIdle.length > 0) {
      throw new Error("Launch or dispatch your completed colony ship before starting a new build.");
    }

    const costProgress = system.colonyShipBuildCost ?? 0;
    const progress = system.colonyShipBuildProgress ?? 0;
    if (system.colonyShipBuildEnabled === true && progress < costProgress && costProgress > 0) {
      throw new Error("A colony ship is already under construction here.");
    }

    const holding = await ctx.db
      .query("emp_system_holdings")
      .withIndex("by_gameId_and_systemId", (q) =>
        q.eq("gameId", args.gameId).eq("systemId", system._id),
      )
      .unique();

    const settings = await loadGameSettings(ctx, args.gameId);
    const maxShips = estimateHomeworldMaxShipsPerTurn({
      system,
      holding: holding ?? undefined,
      empireTaxRate: defaultEmpireTaxRateForBuild(empire),
      settings,
    });
    const cost = computeColonyShipBuildCostShipPoints(maxShips);

    await ctx.db.patch("gal_systems", system._id, {
      colonyShipBuildEnabled: true,
      colonyShipBuildProgress: 0,
      colonyShipBuildCost: cost,
    });

    const game = await ctx.db.get("sim_games", args.gameId);
    const turn = game?.currentTurn ?? 0;
    await insertSimEvent(ctx, {
      gameId: args.gameId,
      turnNumber: turn,
      eventType: "colony_ship_build_started",
      actorType: "system",
      actorId: system._id,
      targetType: "empire",
      targetId: empire._id,
      summary: `${system.name}: colony ship construction started (${cost} ship points)`,
      payload: { systemId: system._id, empireId: empire._id, costShipPoints: cost },
    });

    await invalidateOpenTurnPreparation(ctx, args.gameId);
    return null;
  },
});

export const cancelColonyShipBuild = mutation({
  args: {
    gameId: v.id("sim_games"),
    gameActorId: v.optional(v.id("sim_game_actors")),
    systemId: v.id("gal_systems"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Authentication required.");

    const { system } = await assertEmpireControlsHomeworld(ctx, {
      gameId: args.gameId,
      userId,
      systemId: args.systemId,
    });
    if (args.gameActorId !== undefined && system.ownerEmpireId !== null) {
      await assertGameActorMatchesEmpire(ctx, {
        gameId: args.gameId,
        gameActorId: args.gameActorId,
        empireId: system.ownerEmpireId,
      });
    }

    await ctx.db.patch("gal_systems", system._id, {
      colonyShipBuildEnabled: false,
      colonyShipBuildProgress: 0,
      colonyShipBuildCost: 0,
    });
    await invalidateOpenTurnPreparation(ctx, args.gameId);
    return null;
  },
});

export const dispatchColonyShip = mutation({
  args: {
    gameId: v.id("sim_games"),
    gameActorId: v.optional(v.id("sim_game_actors")),
    colonyShipId: v.id("col_colony_ships"),
    /** Ordered hyperspace hops from the ship's current system; first id is the first destination. */
    routeSystemIds: v.array(v.id("gal_systems")),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Authentication required.");

    const { ship, access } = await assertControlsColonyShip(ctx, {
      gameId: args.gameId,
      userId,
      colonyShipId: args.colonyShipId,
    });
    if (args.gameActorId !== undefined) {
      await assertGameActorMatchesEmpire(ctx, {
        gameId: args.gameId,
        gameActorId: args.gameActorId,
        empireId: ship.empireId,
      });
    }

    if (ship.status !== "idle") {
      throw new Error("Colony ship must be idle to dispatch.");
    }

    const fromId = ship.originSystemId;
    const route = args.routeSystemIds;
    if (route.length === 0) {
      throw new Error("Choose a route with at least one destination system.");
    }
    if (route[0] === fromId) {
      throw new Error("Route cannot start by returning to the launch system.");
    }

    const originSystem = await ctx.db.get("gal_systems", fromId);
    if (originSystem === null) throw new Error("Origin system missing.");
    const empire = await ctx.db.get("emp_states", ship.empireId);
    if (empire === null) throw new Error("Empire missing.");
    const originOwnedByShipActor =
      ship.gameActorId !== undefined &&
      ship.gameActorId !== null &&
      originSystem.ownerGameActorId !== undefined &&
      originSystem.ownerGameActorId !== null
        ? originSystem.ownerGameActorId === ship.gameActorId
        : originSystem.ownerEmpireId === ship.empireId;
    if (!originOwnedByShipActor) {
      throw new Error("Colony ships may only depart from worlds your empire controls.");
    }

    const systemsById = new Map<Id<"gal_systems">, Doc<"gal_systems">>();
    for (const sid of route) {
      const s = await ctx.db.get("gal_systems", sid);
      if (s === null || s.gameId !== args.gameId) {
        throw new Error("Route references an unknown system.");
      }
      systemsById.set(sid, s);
    }

    const routeErr = validateColonyShipRouteDestinations({
      routeSystemIds: route,
      empireId: ship.empireId,
      actorId: ship.gameActorId ?? null,
      getOwner: (id) => {
        const system = systemsById.get(id);
        return {
          ownerEmpireId: system?.ownerEmpireId ?? null,
          ownerActorId: system?.ownerGameActorId ?? null,
        };
      },
    });
    if (routeErr !== null) throw new Error(routeErr);

    let cursor = fromId;
    for (const next of route) {
      const hop = await findLinkBetweenSystems(ctx, args.gameId, cursor, next);
      if (hop === null) {
        throw new Error("Route must follow direct hyperspace links between each system.");
      }
      cursor = next;
    }

    const homeSystemId = empire.homeSystemId;
    let homeworldPopBeforeDispatch: number | null = null;
    if (fromId === homeSystemId) {
      const pop = clampPopulationPeople(originSystem.population ?? 0);
      if (pop < COLONY_SHIP_POP_CARGO_PEOPLE) {
        throw new Error(
          `Homeworld needs at least ${COLONY_SHIP_POP_CARGO_PEOPLE.toLocaleString()} people to crew and supply a colony ship.`,
        );
      }
      homeworldPopBeforeDispatch = pop;
    }

    const game = await ctx.db.get("sim_games", args.gameId);
    if (game === null) throw new Error("Game not found.");

    const firstDest = route[0];
    const link0 = await findLinkBetweenSystems(ctx, args.gameId, fromId, firstDest);
    if (link0 === null) throw new Error("No direct hyperspace link to the first destination.");
    const turns0 = travelTurnsFromLinkCost(link0.travelCost);
    const etaTurn = game.currentTurn + turns0;
    const rest = route.slice(1);

    if (homeworldPopBeforeDispatch !== null) {
      await ctx.db.patch("gal_systems", originSystem._id, {
        population: clampPopulationPeople(
          homeworldPopBeforeDispatch - COLONY_SHIP_POP_CARGO_PEOPLE,
        ),
      });
    }

    const resolvedShipGameActorId =
      ship.gameActorId ?? access.controlledGameActorId ?? null;

    await ctx.db.patch("col_colony_ships", ship._id, {
      ...(resolvedShipGameActorId !== null ? { gameActorId: resolvedShipGameActorId } : {}),
      destinationSystemId: firstDest,
      etaTurn,
      status: "enRoute",
      dispatchedTurn: game.currentTurn,
      travelTurnsTotal: turns0,
      routeRemainingSystemIds: rest.length > 0 ? rest : undefined,
    });

    const finalDest = route[route.length - 1];
    await insertSimEvent(ctx, {
      gameId: args.gameId,
      turnNumber: game.currentTurn,
      eventType: "colony_ship_dispatched",
      actorType: "colony_ship",
      actorId: ship._id,
      targetType: "system",
      targetId: finalDest,
      summary:
        route.length > 1
          ? `${ship.name} dispatched on a ${route.length}-hop route (first leg ETA turn ${etaTurn})`
          : `${ship.name} dispatched toward colony site (ETA turn ${etaTurn})`,
      payload: {
        colonyShipId: ship._id,
        fromSystemId: fromId,
        routeSystemIds: route,
        firstLegTo: firstDest,
        etaTurn,
        cargoPeople: COLONY_SHIP_POP_CARGO_PEOPLE,
      },
    });

    await invalidateOpenTurnPreparation(ctx, args.gameId);
    return null;
  },
});

export const colonize = mutation({
  args: {
    gameId: v.id("sim_games"),
    gameActorId: v.optional(v.id("sim_game_actors")),
    colonyShipId: v.id("col_colony_ships"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Authentication required.");

    const { ship, access } = await assertControlsColonyShip(ctx, {
      gameId: args.gameId,
      userId,
      colonyShipId: args.colonyShipId,
    });
    const resolvedShipGameActorId = ship.gameActorId ?? access.controlledGameActorId ?? null;
    if (args.gameActorId !== undefined) {
      await assertGameActorMatchesEmpire(ctx, {
        gameId: args.gameId,
        gameActorId: args.gameActorId,
        empireId: ship.empireId,
      });
    }

    if (ship.status !== "idle") {
      throw new Error("Colony ship must be idle at the target system to colonize.");
    }

    const target = await ctx.db.get("gal_systems", ship.originSystemId);
    if (target === null) throw new Error("Target system not found.");

    if (target.gameId !== args.gameId) {
      throw new Error("System is not in this game.");
    }

    if (target.ownerEmpireId !== null) {
      throw new Error("That system is already claimed.");
    }

    const pop = target.population ?? 0;
    if (pop >= POPULATION_MIN_INHABITED_PEOPLE) {
      throw new Error("That world already has a substantial population.");
    }

    const game = await ctx.db.get("sim_games", args.gameId);
    if (game === null) throw new Error("Game not found.");

    const resolvedWinnerGameActorId = args.gameActorId ?? resolvedShipGameActorId;

    await reconcileSystemHolding(ctx, {
      gameId: args.gameId,
      systemId: target._id,
      winnerEmpireId: ship.empireId,
      ...(resolvedWinnerGameActorId !== null && resolvedWinnerGameActorId !== undefined
        ? { winnerGameActorId: resolvedWinnerGameActorId }
        : {}),
    });

    await ctx.db.patch("gal_systems", target._id, {
      ownerEmpireId: ship.empireId,
      ownerGameActorId: resolvedWinnerGameActorId ?? undefined,
      population: COLONY_SHIP_POP_CARGO_PEOPLE,
      colonyFoodBonusPerTurn: COLONY_NEW_WORLD_FOOD_BONUS_PER_TURN,
      stockFood: Math.max(COLONY_NEW_WORLD_STARTER_FOOD, target.stockFood ?? 0),
      taxBlockedUntilTurn: game.currentTurn + 1,
      underAttack: false,
    });

    await ctx.db.delete("col_colony_ships", ship._id);

    await insertSimEvent(ctx, {
      gameId: args.gameId,
      turnNumber: game.currentTurn,
      eventType: "system_colonized",
      actorType: "empire",
      actorId: ship.empireId,
      targetType: "system",
      targetId: target._id,
      summary: `${target.name} colonized`,
      payload: {
        systemId: target._id,
        empireId: ship.empireId,
        population: COLONY_SHIP_POP_CARGO_PEOPLE,
        foodBonusPerTurn: COLONY_NEW_WORLD_FOOD_BONUS_PER_TURN,
      },
    });

    await invalidateOpenTurnPreparation(ctx, args.gameId);
    return null;
  },
});
