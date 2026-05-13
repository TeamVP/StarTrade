import { internalAction } from "../_generated/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";

export const resolveTurnJob = internalAction({
  args: {
    gameId: v.id("sim_games"),
    turnNumber: v.number(),
  },
  handler: async (ctx, args): Promise<{ resolvedTurn: number; nextTurn: number }> => {
    await ctx.runMutation(internal.sim.internal.resolveTurnMovementPhase, args);
    await ctx.runMutation(internal.sim.internal.resolveTurnEconomyPhase, args);
    await ctx.runMutation(internal.sim.internal.resolveTurnNpcPhase, args);
    await ctx.runMutation(internal.sim.internal.resolveTurnTradePhase, args);
    await ctx.runMutation(internal.sim.internal.resolveTurnTraderSetupPhase, args);
    await ctx.runMutation(internal.sim.internal.resolveTurnTradeSpawnPhase, args);
    await ctx.runMutation(internal.sim.internal.resolveTurnGarrisonsPhase, args);
    const result: {
      skipped: boolean;
      resolvedTurn: number;
      nextTurn: number;
    } = await ctx.runMutation(internal.sim.internal.finalizeTurnResolution, args);
    return { resolvedTurn: result.resolvedTurn, nextTurn: result.nextTurn };
  },
});
