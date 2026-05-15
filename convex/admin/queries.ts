import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { query } from "../_generated/server";

export const listUsers = query({
  args: {
    limit: v.number(),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      return { authorized: false, users: [] };
    }

    const limit = Math.min(Math.max(Math.floor(args.limit), 1), 100);
    const users = await ctx.db.query("users").order("desc").take(limit);

    return {
      authorized: true,
      users: users.map((user) => ({
        _id: user._id,
        createdAt: user._creationTime,
        name: user.name ?? null,
        email: user.email ?? null,
        phone: user.phone ?? null,
        image: user.image ?? null,
        emailVerificationTime: user.emailVerificationTime ?? null,
        phoneVerificationTime: user.phoneVerificationTime ?? null,
        isAnonymous: user.isAnonymous ?? false,
      })),
    };
  },
});