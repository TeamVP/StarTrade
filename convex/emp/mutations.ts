import { mutation } from "../_generated/server";
import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";

const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

function validateStrategyJson(strategyJson: string): string {
  const trimmed = strategyJson.trim();
  if (trimmed.length === 0) {
    throw new Error("Strategy JSON cannot be empty.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new Error("Strategy JSON must be valid JSON.");
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("Strategy JSON must be a JSON object.");
  }

  return JSON.stringify(parsed, null, 2);
}

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

export const updateEmpireMeta = mutation({
  args: {
    empireId: v.id("emp_states"),
    name: v.optional(v.string()),
    colorHex: v.optional(v.string()),
    playerName: v.optional(v.string()),
    strategyJson: v.optional(v.union(v.string(), v.null())),
  },
  handler: async (ctx, args) => {
    const empire = await ctx.db.get("emp_states", args.empireId);
    if (empire === null) {
      throw new Error("Empire not found.");
    }

    const userId = await getAuthUserId(ctx);

    const patch: {
      name?: string;
      colorHex?: string;
      playerName?: string;
      strategyJson?: string | undefined;
    } = {};

    if (args.name !== undefined) {
      const name = args.name.trim();
      if (name.length === 0) {
        throw new Error("Empire name cannot be empty.");
      }
      patch.name = name;
    }

    if (args.colorHex !== undefined) {
      const raw = args.colorHex.trim();
      if (!HEX_COLOR_RE.test(raw)) {
        throw new Error("Color must be a #RRGGBB hex value.");
      }
      const colorHex = raw.toLowerCase();
      patch.colorHex = colorHex;

      if (userId !== null) {
        const preferenceKey =
          empire.npcPlayerKey !== undefined && empire.npcPlayerKey.length > 0
            ? empire.npcPlayerKey
            : empire.empireKey;
        const existing = await ctx.db
          .query("usr_empire_color_prefs")
          .withIndex("by_userId_and_preferenceKey", (q) =>
            q.eq("userId", userId).eq("preferenceKey", preferenceKey),
          )
          .unique();
        if (existing === null) {
          await ctx.db.insert("usr_empire_color_prefs", {
            userId,
            preferenceKey,
            colorHex,
          });
        } else {
          await ctx.db.patch("usr_empire_color_prefs", existing._id, {
            colorHex,
          });
        }
      }
    }

    if (args.playerName !== undefined) {
      const playerName = args.playerName.trim();
      patch.playerName = playerName.length === 0 ? undefined : playerName;
    }

    if (args.strategyJson !== undefined) {
      patch.strategyJson =
        args.strategyJson === null ? undefined : validateStrategyJson(args.strategyJson);
    }

    await ctx.db.patch("emp_states", args.empireId, patch);
    return args.empireId;
  },
});
