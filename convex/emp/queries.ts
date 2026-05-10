import { query } from "../_generated/server";
import { v } from "convex/values";

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
