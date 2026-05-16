import { internalAction } from "../_generated/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";

export const attemptResolveTurnBoundary = internalAction({
  args: {
    gameId: v.id("sim_games"),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ committed: boolean; started: boolean; turnNumber: number }> => {
    const commit: {
      skipped: boolean;
      committed: boolean;
      resolvedTurn: number;
      nextTurn: number;
    } = await ctx.runMutation(internal.sim.internal.commitPreparedTurn, {
      gameId: args.gameId,
    });
    if (commit.committed) {
      return { committed: true, started: false, turnNumber: commit.nextTurn };
    }

    const begin: {
      started: boolean;
      turnNumber: number;
      alreadyResolving: boolean;
    } = await ctx.runMutation(internal.sim.internal.beginTurnResolution, {
      gameId: args.gameId,
    });
    if (begin.started) {
      await ctx.scheduler.runAfter(0, internal.sim.actions.resolveTurnJob, {
        gameId: args.gameId,
        turnNumber: begin.turnNumber,
      });
    }
    return { committed: false, started: begin.started, turnNumber: begin.turnNumber };
  },
});

export const resolveTurnJob = internalAction({
  args: {
    gameId: v.id("sim_games"),
    turnNumber: v.number(),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ preparedTurn: number; committed: boolean; nextTurn: number }> => {
    await ctx.runMutation(internal.sim.internal.resolveTurnMovementPhase, args);
    await ctx.runMutation(internal.sim.internal.resolveTurnEconomyPhase, args);
    await ctx.runMutation(internal.sim.internal.resolveTurnNpcPhase, args);
    await ctx.runMutation(internal.sim.internal.resolveTurnTradePhase, args);
    await ctx.runMutation(internal.sim.internal.resolveTurnTraderSetupPhase, args);
    await ctx.runMutation(internal.sim.internal.resolveTurnTradeSpawnPhase, args);
    await ctx.runMutation(internal.sim.internal.resolveTurnGarrisonsPhase, args);
    await ctx.runMutation(internal.sim.internal.finalizeTurnPreparation, args);
    const committed: {
      skipped: boolean;
      committed: boolean;
      resolvedTurn: number;
      nextTurn: number;
    } = await ctx.runMutation(internal.sim.internal.commitPreparedTurn, args);
    return {
      preparedTurn: args.turnNumber,
      committed: committed.committed,
      nextTurn: committed.nextTurn,
    };
  },
});

export const recoverPreparedTurnJob = internalAction({
  args: {
    gameId: v.id("sim_games"),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ started: boolean; committed: boolean; nextTurn: number | null }> => {
    await ctx.runMutation(internal.sim.internal.resetCurrentTurnPreparationForRecovery, {
      gameId: args.gameId,
    });

    const begin: {
      started: boolean;
      turnNumber: number;
      alreadyResolving: boolean;
    } = await ctx.runMutation(internal.sim.internal.beginTurnResolution, {
      gameId: args.gameId,
    });
    if (!begin.started) {
      return { started: false, committed: false, nextTurn: begin.turnNumber };
    }

    await ctx.runMutation(internal.sim.internal.resolveTurnMovementPhase, {
      gameId: args.gameId,
      turnNumber: begin.turnNumber,
    });
    await ctx.runMutation(internal.sim.internal.resolveTurnEconomyPhase, {
      gameId: args.gameId,
      turnNumber: begin.turnNumber,
    });
    await ctx.runMutation(internal.sim.internal.resolveTurnNpcPhase, {
      gameId: args.gameId,
      turnNumber: begin.turnNumber,
    });
    await ctx.runMutation(internal.sim.internal.resolveTurnTradePhase, {
      gameId: args.gameId,
      turnNumber: begin.turnNumber,
    });
    await ctx.runMutation(internal.sim.internal.resolveTurnTraderSetupPhase, {
      gameId: args.gameId,
      turnNumber: begin.turnNumber,
    });
    await ctx.runMutation(internal.sim.internal.resolveTurnTradeSpawnPhase, {
      gameId: args.gameId,
      turnNumber: begin.turnNumber,
    });
    await ctx.runMutation(internal.sim.internal.resolveTurnGarrisonsPhase, {
      gameId: args.gameId,
      turnNumber: begin.turnNumber,
    });
    await ctx.runMutation(internal.sim.internal.finalizeTurnPreparation, {
      gameId: args.gameId,
      turnNumber: begin.turnNumber,
    });

    const committed: {
      skipped: boolean;
      committed: boolean;
      resolvedTurn: number;
      nextTurn: number;
    } = await ctx.runMutation(internal.sim.internal.commitPreparedTurn, {
      gameId: args.gameId,
      turnNumber: begin.turnNumber,
    });

    return {
      started: true,
      committed: committed.committed,
      nextTurn: committed.nextTurn,
    };
  },
});
