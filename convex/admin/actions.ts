import { action } from "../_generated/server";
import { v } from "convex/values";

export const reseedGame = action({
  args: {
    gameId: v.id("sim_games"),
    mapKey: v.string(),
  },
  handler: async () => {
    return null;
  },
});
