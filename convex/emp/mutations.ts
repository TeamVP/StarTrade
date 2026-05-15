import { mutation } from "../_generated/server";
import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { gameAllowsPlayerActions } from "../sim/helpers";
import type { StrategicSliderKey, StrategicSliderOverrides } from "../sim/economy/strategicSliders";
import { canonicalizeStrategyJson } from "../usr/automationStrategyLibrary";

const STRATEGIC_LEVEL = v.union(
  v.literal("lowest"),
  v.literal("low"),
  v.literal("medium"),
  v.literal("high"),
  v.literal("highest"),
);

const SLIDER_KEY = v.union(
  v.literal("militaryAggression"),
  v.literal("expansion"),
  v.literal("defensivePosture"),
  v.literal("priorityOperations"),
  v.literal("economicMobilization"),
);

async function assertEmpireSeatForGame(
  ctx: MutationCtx,
  params: { gameId: Id<"sim_games">; userId: Id<"users"> },
): Promise<Id<"emp_states">> {
  const binding = await ctx.db
    .query("usr_game_roles")
    .withIndex("by_gameId_and_userId", (q) =>
      q.eq("gameId", params.gameId).eq("userId", params.userId),
    )
    .unique();
  if (
    binding === null ||
    !binding.isActive ||
    binding.role !== "empire" ||
    binding.empireId === null
  ) {
    throw new Error("You need an active empire seat in this game.");
  }
  return binding.empireId;
}

const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

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
        args.strategyJson === null ? undefined : canonicalizeStrategyJson(args.strategyJson);
    }

    await ctx.db.patch("emp_states", args.empireId, patch);
    return args.empireId;
  },
});

/**
 * Set or clear one strategic slider override for the caller's empire.
 * Pass `level: null` to revert that axis to the default implied by strategy JSON.
 */
export const patchStrategicSlider = mutation({
  args: {
    gameId: v.id("sim_games"),
    key: SLIDER_KEY,
    level: v.union(STRATEGIC_LEVEL, v.null()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");

    const game = await ctx.db.get("sim_games", args.gameId);
    if (game === null) throw new Error("Game not found.");
    if (!gameAllowsPlayerActions(game.status)) {
      throw new Error(
        "Strategic sliders can only be changed while the game is running or paused.",
      );
    }

    const empireId = await assertEmpireSeatForGame(ctx, {
      gameId: args.gameId,
      userId,
    });
    const empire = await ctx.db.get("emp_states", empireId);
    if (empire === null || empire.gameId !== args.gameId) {
      throw new Error("Empire not found.");
    }

    const key = args.key as StrategicSliderKey;
    const prev: StrategicSliderOverrides = { ...(empire.strategicSliderOverrides ?? {}) };
    if (args.level === null) {
      delete prev[key];
    } else {
      prev[key] = args.level;
    }
    const keys = Object.keys(prev) as Array<keyof StrategicSliderOverrides>;
    await ctx.db.patch("emp_states", empireId, {
      strategicSliderOverrides: keys.length > 0 ? prev : undefined,
    });
    return null;
  },
});
