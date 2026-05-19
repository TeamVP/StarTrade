import { mutation } from "../_generated/server";
import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { gameAllowsPlayerActions, touchGameMeaningfulActivity } from "../sim/helpers";
import { invalidateOpenTurnPreparation } from "../sim/turnPreparationInvalidation";
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
  if (binding === null || !binding.isActive || binding.role !== "empire") {
    throw new Error("You need an active empire seat in this game.");
  }
  if (binding.empireId !== null) {
    return binding.empireId;
  }

  const game = await ctx.db.get("sim_games", params.gameId);
  const runtimeVersion = game?.runtimeVersion ?? "v1_empire";
  if (runtimeVersion === "v2_game_actor") {
    const actor = await ctx.db
      .query("sim_game_actors")
      .withIndex("by_gameId_and_controllerUserId", (q) =>
        q.eq("gameId", params.gameId).eq("controllerUserId", params.userId),
      )
      .unique();
    if (actor?.legacyEmpireId !== null && actor?.legacyEmpireId !== undefined) {
      return actor.legacyEmpireId;
    }
  }

  throw new Error("You need an active empire seat in this game.");
}

async function resolveEmpireIdForMetaUpdate(
  ctx: MutationCtx,
  args: {
    empireId?: Id<"emp_states">;
    gameActorId?: Id<"sim_game_actors">;
  },
): Promise<Id<"emp_states">> {
  if (args.empireId !== undefined) {
    return args.empireId;
  }
  if (args.gameActorId === undefined) {
    throw new Error("Empire target is required.");
  }

  const actor = await ctx.db.get("sim_game_actors", args.gameActorId);
  if (actor === null) {
    throw new Error("Game actor not found.");
  }
  if (actor.legacyEmpireId === null) {
    throw new Error("This game actor is not linked to a legacy empire row.");
  }
  return actor.legacyEmpireId;
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
    empireId: v.optional(v.id("emp_states")),
    gameActorId: v.optional(v.id("sim_game_actors")),
    name: v.optional(v.string()),
    colorHex: v.optional(v.string()),
    playerName: v.optional(v.string()),
    strategyJson: v.optional(v.union(v.string(), v.null())),
    strategyStartMode: v.optional(
      v.union(
        v.literal("turn"),
        v.literal("attacked"),
        v.literal("intruder_detection"),
      ),
    ),
    strategyStartTurn: v.optional(v.union(v.number(), v.null())),
  },
  handler: async (ctx, args) => {
    const empireId = await resolveEmpireIdForMetaUpdate(ctx, {
      empireId: args.empireId,
      gameActorId: args.gameActorId,
    });
    const empire = await ctx.db.get("emp_states", empireId);
    if (empire === null) {
      throw new Error("Empire not found.");
    }

    const userId = await getAuthUserId(ctx);

    const patch: {
      name?: string;
      colorHex?: string;
      playerName?: string;
      strategyJson?: string | undefined;
      strategyLibraryKey?: string | null;
      strategyStartMode?: "turn" | "attacked" | "intruder_detection";
      strategyStartTurn?: number | undefined;
      strategyActivatedAtTurn?: number | undefined;
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
      patch.strategyLibraryKey = null;
    }

    if (args.strategyStartMode !== undefined) {
      patch.strategyStartMode = args.strategyStartMode;
      patch.strategyActivatedAtTurn = undefined;
    }

    if (args.strategyStartTurn !== undefined) {
      if (args.strategyStartTurn === null) {
        patch.strategyStartTurn = undefined;
      } else {
        const normalizedTurn = Math.max(1, Math.floor(args.strategyStartTurn));
        patch.strategyStartTurn = normalizedTurn;
      }
      patch.strategyActivatedAtTurn = undefined;
    }

    await ctx.db.patch("emp_states", empireId, patch);
    if (
      args.strategyJson !== undefined ||
      args.strategyStartMode !== undefined ||
      args.strategyStartTurn !== undefined
    ) {
      await invalidateOpenTurnPreparation(ctx, empire.gameId);
    }
    await touchGameMeaningfulActivity(ctx, empire.gameId, {
      humanAction: userId !== null,
    });
    return empireId;
  },
});

/**
 * Set or clear one strategic slider override for the caller's empire.
 * Pass `level: null` to revert that axis to the default implied by strategy JSON.
 */
export const patchStrategicSlider = mutation({
  args: {
    gameId: v.id("sim_games"),
    gameActorId: v.optional(v.id("sim_game_actors")),
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
    if (args.gameActorId !== undefined) {
      const actor = await ctx.db.get("sim_game_actors", args.gameActorId);
      if (actor === null || actor.gameId !== args.gameId) {
        throw new Error("Game actor not found.");
      }
      if (actor.legacyEmpireId !== empireId) {
        throw new Error("Game actor does not match your empire seat.");
      }
    }
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
    await invalidateOpenTurnPreparation(ctx, args.gameId);
    await touchGameMeaningfulActivity(ctx, args.gameId, { humanAction: true });
    return null;
  },
});
