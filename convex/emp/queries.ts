import { query } from "../_generated/server";
import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { parseAutomation } from "../sim/economy/applyNpcStrategy";
import {
  STRATEGIC_SLIDER_LABELS,
  computeStrategicSliderDefaults,
  resolveStrategicSliders,
} from "../sim/economy/strategicSliders";

export const getMyStrategicSliders = query({
  args: { gameId: v.id("sim_games") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return null;

    const binding = await ctx.db
      .query("usr_game_roles")
      .withIndex("by_gameId_and_userId", (q) =>
        q.eq("gameId", args.gameId).eq("userId", userId),
      )
      .unique();

    if (
      binding === null ||
      !binding.isActive ||
      binding.role !== "empire" ||
      binding.empireId === null
    ) {
      return null;
    }

    const empire = await ctx.db.get("emp_states", binding.empireId);
    if (empire === null || empire.gameId !== args.gameId) return null;

    if (empire.strategyJson === undefined) {
      return {
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
    return await ctx.db
      .query("emp_states")
      .withIndex("by_gameId", (q) => q.eq("gameId", args.gameId))
      .take(args.limit);
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
