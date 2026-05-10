import { mutation } from "../_generated/server";
import { v } from "convex/values";

export const adjustTreasury = mutation({
  args: {
    empireId: v.id("emp_states"),
    delta: v.number(),
  },
  handler: async (ctx, args) => {
    const empire = await ctx.db.get("emp_states", args.empireId);
    if (empire === null) {
      throw new Error("Empire not found.");
    }

    await ctx.db.patch("emp_states", args.empireId, {
      treasury: empire.treasury + args.delta,
    });
    return args.empireId;
  },
});
