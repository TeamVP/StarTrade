import { internalMutation } from "../_generated/server";
import { v } from "convex/values";

export const setEmpireCollapsed = internalMutation({
  args: {
    empireId: v.id("emp_states"),
    isCollapsed: v.boolean(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch("emp_states", args.empireId, {
      isCollapsed: args.isCollapsed,
    });
    return args.empireId;
  },
});
