import { query, type QueryCtx } from "../_generated/server";
import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import type { Id } from "../_generated/dataModel";
import { parseAutomation } from "../sim/economy/applyNpcStrategy";
import {
  STRATEGIC_SLIDER_LABELS,
  computeStrategicSliderDefaults,
  resolveStrategicSliders,
} from "../sim/economy/strategicSliders";

function resolveGameRuntimeVersion(
  runtimeVersion: "v1_empire" | "v2_game_actor" | null | undefined,
): "v1_empire" | "v2_game_actor" {
  return runtimeVersion ?? "v1_empire";
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

export const getMyStrategicSliders = query({
  args: { gameId: v.id("sim_games") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return null;

    const game = await ctx.db.get("sim_games", args.gameId);
    const runtimeVersion = resolveGameRuntimeVersion(game?.runtimeVersion);

    const binding = await ctx.db
      .query("usr_game_roles")
      .withIndex("by_gameId_and_userId", (q) =>
        q.eq("gameId", args.gameId).eq("userId", userId),
      )
      .unique();

    if (binding === null || !binding.isActive) {
      return null;
    }

    const empireId = await resolveControlledEmpireIdForRole(ctx, {
      gameId: args.gameId,
      runtimeVersion,
      userId,
      role: binding.role,
      empireId: binding.empireId,
    });
    if (empireId === null) {
      return null;
    }

    const empire = await ctx.db.get("emp_states", empireId);
    if (empire === null || empire.gameId !== args.gameId) return null;
    const actor =
      runtimeVersion !== "v2_game_actor"
        ? null
        : await ctx.db
            .query("sim_game_actors")
            .withIndex("by_gameId_and_legacyEmpireId", (q) =>
              q.eq("gameId", args.gameId).eq("legacyEmpireId", empire._id),
            )
            .unique();

    if (empire.strategyJson === undefined) {
      return {
        runtimeVersion,
        actorId: actor?._id ?? null,
        actorSlotNumber: actor?.slotNumber ?? null,
        actorLabel: actor?.factionLabelSnapshot ?? null,
        actorDisplayName: actor?.displayNameSnapshot ?? null,
        empireId: empire._id,
        defaults: null,
        effective: null,
        overrides: null,
        labels: STRATEGIC_SLIDER_LABELS,
      };
    }

    const automation = parseAutomation(empire.strategyJson);
    if (automation === null) {
      return {
        runtimeVersion,
        actorId: actor?._id ?? null,
        actorSlotNumber: actor?.slotNumber ?? null,
        actorLabel: actor?.factionLabelSnapshot ?? null,
        actorDisplayName: actor?.displayNameSnapshot ?? null,
        empireId: empire._id,
        defaults: null,
        effective: null,
        overrides: empire.strategicSliderOverrides ?? null,
        labels: STRATEGIC_SLIDER_LABELS,
      };
    }

    const defaults = computeStrategicSliderDefaults(automation);
    const effective = resolveStrategicSliders(defaults, empire.strategicSliderOverrides);

    return {
      runtimeVersion,
      actorId: actor?._id ?? null,
      actorSlotNumber: actor?.slotNumber ?? null,
      actorLabel: actor?.factionLabelSnapshot ?? null,
      actorDisplayName: actor?.displayNameSnapshot ?? null,
      empireId: empire._id,
      defaults,
      effective,
      overrides: empire.strategicSliderOverrides ?? null,
      labels: STRATEGIC_SLIDER_LABELS,
    };
  },
});

export const listEmpires = query({
  args: { gameId: v.id("sim_games"), limit: v.number() },
  handler: async (ctx, args) => {
    const game = await ctx.db.get("sim_games", args.gameId);
    const runtimeVersion = resolveGameRuntimeVersion(game?.runtimeVersion);
    const empires = await ctx.db
      .query("emp_states")
      .withIndex("by_gameId", (q) => q.eq("gameId", args.gameId))
      .take(args.limit);

    if (runtimeVersion !== "v2_game_actor") {
      return empires.map((empire) => ({
        ...empire,
        runtimeVersion,
        actorId: null,
        actorSlotNumber: null,
        actorLabel: null,
        actorDisplayName: null,
      }));
    }

    const actors = await ctx.db
      .query("sim_game_actors")
      .withIndex("by_gameId", (q) => q.eq("gameId", args.gameId))
      .collect();
    const actorByLegacyEmpireId = new Map(
      actors
        .filter((actor) => actor.legacyEmpireId !== null)
        .map((actor) => [actor.legacyEmpireId!, actor] as const),
    );

    return empires.map((empire) => {
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
  },
});

export const listEmpireSystems = query({
  args: { gameId: v.id("sim_games"), empireId: v.id("emp_states") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("emp_system_holdings")
      .withIndex("by_gameId_and_empireId", (q) =>
        q.eq("gameId", args.gameId).eq("empireId", args.empireId),
      )
      .take(256);
  },
});
