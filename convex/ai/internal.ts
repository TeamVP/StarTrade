import { internalAction } from "../_generated/server";
import { v } from "convex/values";

export const runAiTurn = internalAction({
  args: {
    gameId: v.id("sim_games"),
    turnNumber: v.number(),
  },
  handler: async (_ctx, _args) => {
    return null;
  },
});
