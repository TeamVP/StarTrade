import { internalMutation } from "../_generated/server";
import { v } from "convex/values";

export const setFleetRoute = internalMutation({
  args: {
    fleetId: v.id("flt_fleets"),
    destinationSystemId: v.id("gal_systems"),
    etaTurn: v.number(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch("flt_fleets", args.fleetId, {
      destinationSystemId: args.destinationSystemId,
      etaTurn: args.etaTurn,
      status: "enRoute",
    });
    return args.fleetId;
  },
});
