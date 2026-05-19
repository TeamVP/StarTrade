import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { mutation, type MutationCtx } from "../_generated/server";
import { api } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { assignOwnerEmpireSeat } from "../sim/mutations";
import { persistLoadedGameMode } from "../sim/gameMode";
import { canonicalizeStrategyJson } from "../usr/automationStrategyLibrary";
import { getAutomationStrategyByKey } from "../usr/automationStrategyCatalog";
import {
  canonicalizeMissionScenarioJson,
  getMissionPlayerSlotKey,
  getMissionByKey,
  listMissionAutomatedActorKeys,
  listMissionSeededNpcPersonaKeys,
  missionIsAvailableForTier,
} from "../usr/missionCatalog";
import {
  assertMayTransitionContentStatus,
  getPublisherViewer,
  isTerminalContentStatus,
  resolvePublisherContentReviewStatus,
  resolvePublisherContentStatus,
  viewerCanManageOwnedContent,
  viewerHasPublisherRights,
  type PublisherContentStatus,
} from "../usr/publisherAccess";
import {
  releaseUserFromGameForNewAttempt,
  shouldRefreshMissionGame,
} from "../usr/mutations";

function normalizeRequiredText(value: string, label: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new Error(`${label} is required.`);
  }
  return normalized;
}

function normalizeDescription(value: string): string {
  return value.trim();
}

function normalizeSortOrder(value: number, label: string): number {
  if (!Number.isFinite(value)) {
    throw new Error(`${label} must be a number.`);
  }
  return Math.max(0, Math.floor(value));
}

function normalizeLevel(value: number): number {
  if (!Number.isFinite(value)) {
    throw new Error("Mission level must be a number.");
  }
  return Math.max(1, Math.floor(value));
}

function normalizeRequiredWins(value: number): number {
  if (!Number.isFinite(value)) {
    throw new Error("Mission required wins must be a number.");
  }
  return Math.max(1, Math.floor(value));
}

function normalizeTags(tags: string[]): string[] {
  return tags.map((tag) => tag.trim()).filter((tag) => tag.length > 0);
}

function normalizeMissionPrerequisites(prerequisiteMissionKeys: string[]): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const rawKey of prerequisiteMissionKeys) {
    const key = rawKey.trim();
    if (key.length === 0 || seen.has(key)) {
      continue;
    }
    seen.add(key);
    normalized.push(key);
  }
  return normalized;
}

async function requirePublisherViewer(ctx: MutationCtx) {
  const userId = await getAuthUserId(ctx);
  if (userId === null) {
    throw new Error("Authentication required.");
  }
  const viewer = await getPublisherViewer(ctx, userId);
  if (!viewerHasPublisherRights(viewer)) {
    throw new Error("Publisher rights are required.");
  }
  return viewer;
}

async function findOwnedMissionGame(
  ctx: MutationCtx,
  userId: Id<"users">,
  missionKey: string,
): Promise<Doc<"sim_games"> | null> {
  const ownedGames = await ctx.db
    .query("sim_games")
    .withIndex("by_ownerUserId", (q) => q.eq("ownerUserId", userId))
    .collect()
    .then((games) => Promise.all(games.map((game) => persistLoadedGameMode(ctx, game))))
    .then((games) => games.filter((game): game is NonNullable<typeof game> => game !== null));

  return ownedGames.find((game) => (game.missionKey ?? game.lobbyScenarioKey) === missionKey) ?? null;
}

function assertEditableCommunityContent(args: {
  ownerUserId: Parameters<typeof viewerCanManageOwnedContent>[1];
  source: "official" | "community" | undefined;
  currentStatus: PublisherContentStatus;
  viewer: Awaited<ReturnType<typeof requirePublisherViewer>>;
}): void {
  if (args.source !== "community") {
    throw new Error("Publisher tools only manage community content.");
  }
  if (!viewerCanManageOwnedContent(args.viewer, args.ownerUserId)) {
    throw new Error("You can only edit your own community content.");
  }
  if (isTerminalContentStatus(args.currentStatus)) {
    throw new Error("This content is in a terminal status and can no longer be edited.");
  }
}

export const createPublisherStrategy = mutation({
  args: {
    key: v.string(),
    name: v.string(),
    description: v.string(),
    tags: v.array(v.string()),
    strategyJson: v.string(),
    availableForHumans: v.boolean(),
    availableForNpcs: v.boolean(),
    status: v.union(v.literal("draft"), v.literal("published")),
  },
  handler: async (ctx, args) => {
    const viewer = await requirePublisherViewer(ctx);
    const key = normalizeRequiredText(args.key, "Strategy key");
    const existing = await getAutomationStrategyByKey(ctx, key);
    if (existing !== null) {
      throw new Error("That strategy key already exists.");
    }

    const now = Date.now();
    return await ctx.db.insert("usr_automation_strategies", {
      key,
      name: normalizeRequiredText(args.name, "Strategy name"),
      description: normalizeDescription(args.description),
      tags: normalizeTags(args.tags),
      strategyJson: canonicalizeStrategyJson(args.strategyJson),
      ownerUserId: viewer.userId,
      source: "community",
      reviewStatus: resolvePublisherContentReviewStatus({
        source: "community",
        reviewStatus: undefined,
      }),
      status: args.status,
      availableForHumans: args.availableForHumans,
      availableForNpcs: args.availableForNpcs,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const updatePublisherStrategy = mutation({
  args: {
    key: v.string(),
    name: v.optional(v.string()),
    description: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
    strategyJson: v.optional(v.string()),
    availableForHumans: v.optional(v.boolean()),
    availableForNpcs: v.optional(v.boolean()),
    status: v.optional(
      v.union(
        v.literal("draft"),
        v.literal("published"),
        v.literal("archived"),
        v.literal("deleted"),
        v.literal("admin_deleted"),
      ),
    ),
  },
  handler: async (ctx, args) => {
    const viewer = await requirePublisherViewer(ctx);
    const key = normalizeRequiredText(args.key, "Strategy key");
    const existing = await getAutomationStrategyByKey(ctx, key);
    if (existing === null) {
      throw new Error("Strategy not found.");
    }

    const currentStatus = resolvePublisherContentStatus({ status: existing.status });
    assertEditableCommunityContent({
      ownerUserId: existing.ownerUserId ?? null,
      source: existing.source,
      currentStatus,
      viewer,
    });

    const nextStatus = args.status ?? currentStatus;
    assertMayTransitionContentStatus({
      currentStatus,
      nextStatus,
      isAdmin: viewer.admin,
    });

    const patch: {
      name?: string;
      description?: string;
      tags?: string[];
      strategyJson?: string;
      availableForHumans?: boolean;
      availableForNpcs?: boolean;
      status?: PublisherContentStatus;
      updatedAt: number;
    } = {
      updatedAt: Date.now(),
    };

    if (args.name !== undefined) {
      patch.name = normalizeRequiredText(args.name, "Strategy name");
    }
    if (args.description !== undefined) {
      patch.description = normalizeDescription(args.description);
    }
    if (args.tags !== undefined) {
      patch.tags = normalizeTags(args.tags);
    }
    if (args.strategyJson !== undefined) {
      patch.strategyJson = canonicalizeStrategyJson(args.strategyJson);
    }
    if (args.availableForHumans !== undefined) {
      patch.availableForHumans = args.availableForHumans;
    }
    if (args.availableForNpcs !== undefined) {
      patch.availableForNpcs = args.availableForNpcs;
    }
    if (args.status !== undefined) {
      patch.status = args.status;
    }

    await ctx.db.patch(existing._id, patch);
    return { key };
  },
});

export const createPublisherMission = mutation({
  args: {
    key: v.string(),
    name: v.string(),
    description: v.string(),
    mapKey: v.string(),
    mode: v.union(
      v.literal("conquest_core"),
      v.literal("conquest_plus"),
      v.literal("trader_economy"),
    ),
    requiredTier: v.union(v.literal("free"), v.literal("pro")),
    level: v.number(),
    requiredWins: v.number(),
    prerequisiteMissionKeys: v.array(v.string()),
    sortOrder: v.number(),
    retentionClass: v.union(
      v.literal("discarded"),
      v.literal("official"),
      v.literal("archived_debug"),
    ),
    scenarioJson: v.string(),
    status: v.union(v.literal("draft"), v.literal("published")),
  },
  handler: async (ctx, args) => {
    const viewer = await requirePublisherViewer(ctx);
    const key = normalizeRequiredText(args.key, "Mission key");
    const existing = await getMissionByKey(ctx, key);
    if (existing !== null) {
      throw new Error("That mission key already exists.");
    }

    const now = Date.now();
    return await ctx.db.insert("sim_missions", {
      key,
      name: normalizeRequiredText(args.name, "Mission name"),
      description: normalizeDescription(args.description),
      mapKey: normalizeRequiredText(args.mapKey, "Map key"),
      ownerUserId: viewer.userId,
      source: "community",
      reviewStatus: resolvePublisherContentReviewStatus({
        source: "community",
        reviewStatus: undefined,
      }),
      status: args.status,
      mode: args.mode,
      requiredTier: args.requiredTier,
      level: normalizeLevel(args.level),
      requiredWins: normalizeRequiredWins(args.requiredWins),
      prerequisiteMissionKeys: normalizeMissionPrerequisites(args.prerequisiteMissionKeys),
      published: args.status === "published",
      sortOrder: normalizeSortOrder(args.sortOrder, "Mission sort order"),
      retentionClass: args.retentionClass,
      scenarioJson: canonicalizeMissionScenarioJson(args.scenarioJson),
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const updatePublisherMission = mutation({
  args: {
    key: v.string(),
    name: v.optional(v.string()),
    description: v.optional(v.string()),
    mapKey: v.optional(v.string()),
    mode: v.optional(
      v.union(
        v.literal("conquest_core"),
        v.literal("conquest_plus"),
        v.literal("trader_economy"),
      ),
    ),
    requiredTier: v.optional(v.union(v.literal("free"), v.literal("pro"))),
    level: v.optional(v.number()),
    requiredWins: v.optional(v.number()),
    prerequisiteMissionKeys: v.optional(v.array(v.string())),
    sortOrder: v.optional(v.number()),
    retentionClass: v.optional(
      v.union(
        v.literal("discarded"),
        v.literal("official"),
        v.literal("archived_debug"),
      ),
    ),
    scenarioJson: v.optional(v.string()),
    status: v.optional(
      v.union(
        v.literal("draft"),
        v.literal("published"),
        v.literal("archived"),
        v.literal("deleted"),
        v.literal("admin_deleted"),
      ),
    ),
  },
  handler: async (ctx, args) => {
    const viewer = await requirePublisherViewer(ctx);
    const key = normalizeRequiredText(args.key, "Mission key");
    const existing = await ctx.db
      .query("sim_missions")
      .withIndex("by_key", (q) => q.eq("key", key))
      .unique();
    if (existing === null) {
      throw new Error("Mission not found.");
    }

    const currentStatus = resolvePublisherContentStatus({
      status: existing.status,
      published: existing.published,
      defaultDraft: true,
    });
    assertEditableCommunityContent({
      ownerUserId: existing.ownerUserId ?? null,
      source: existing.source,
      currentStatus,
      viewer,
    });

    const nextStatus = args.status ?? currentStatus;
    assertMayTransitionContentStatus({
      currentStatus,
      nextStatus,
      isAdmin: viewer.admin,
    });

    const patch: {
      name?: string;
      description?: string;
      mapKey?: string;
      mode?: "conquest_core" | "conquest_plus" | "trader_economy";
      requiredTier?: "free" | "pro";
      level?: number;
      requiredWins?: number;
      prerequisiteMissionKeys?: string[];
      published?: boolean;
      sortOrder?: number;
      retentionClass?: "discarded" | "official" | "archived_debug";
      scenarioJson?: string;
      status?: PublisherContentStatus;
      updatedAt: number;
    } = {
      updatedAt: Date.now(),
    };

    if (args.name !== undefined) {
      patch.name = normalizeRequiredText(args.name, "Mission name");
    }
    if (args.description !== undefined) {
      patch.description = normalizeDescription(args.description);
    }
    if (args.mapKey !== undefined) {
      patch.mapKey = normalizeRequiredText(args.mapKey, "Map key");
    }
    if (args.mode !== undefined) {
      patch.mode = args.mode;
    }
    if (args.requiredTier !== undefined) {
      patch.requiredTier = args.requiredTier;
    }
    if (args.level !== undefined) {
      patch.level = normalizeLevel(args.level);
    }
    if (args.requiredWins !== undefined) {
      patch.requiredWins = normalizeRequiredWins(args.requiredWins);
    }
    if (args.prerequisiteMissionKeys !== undefined) {
      patch.prerequisiteMissionKeys = normalizeMissionPrerequisites(args.prerequisiteMissionKeys);
    }
    if (args.sortOrder !== undefined) {
      patch.sortOrder = normalizeSortOrder(args.sortOrder, "Mission sort order");
    }
    if (args.retentionClass !== undefined) {
      patch.retentionClass = args.retentionClass;
    }
    if (args.scenarioJson !== undefined) {
      patch.scenarioJson = canonicalizeMissionScenarioJson(args.scenarioJson);
    }
    if (args.status !== undefined) {
      patch.status = args.status;
      patch.published = args.status === "published";
    }

    await ctx.db.patch(existing._id, patch);
    return { key };
  },
});

export const openPublishedCommunityMissionGame = mutation({
  args: {
    missionKey: v.string(),
    restart: v.optional(v.boolean()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ gameId: Id<"sim_games">; urlCode: string | null; created: boolean }> => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      throw new Error("Authentication required.");
    }

    const viewer = await getPublisherViewer(ctx, userId);
    const missionKey = normalizeRequiredText(args.missionKey, "Mission key");
    const mission = await getMissionByKey(ctx, missionKey);
    if (mission === null) {
      throw new Error("Mission not found.");
    }
    if (mission.source !== "community") {
      throw new Error("Only published community missions can be launched here.");
    }

    const missionStatus = resolvePublisherContentStatus({
      status: mission.status,
      published: mission.published,
      defaultDraft: true,
    });
    if (missionStatus !== "published") {
      throw new Error("Only published community missions can be launched here.");
    }
    if (!viewer.admin && !missionIsAvailableForTier(mission, viewer.plan)) {
      throw new Error("Pro is required for that mission.");
    }
    if (mission.mode === "conquest_plus" && !viewer.admin) {
      throw new Error("Conquest plus is unpublished.");
    }

    const current = await findOwnedMissionGame(ctx, userId, missionKey);
    if (current !== null) {
      if (!shouldRefreshMissionGame(current, mission) && args.restart !== true) {
        if (
          current.status === "lobby" ||
          current.status === "running" ||
          current.status === "paused"
        ) {
          const role = await ctx.db
            .query("usr_game_roles")
            .withIndex("by_gameId_and_userId", (q) => q.eq("gameId", current._id).eq("userId", userId))
            .unique();
          if (role === null || !role.isActive) {
            await assignOwnerEmpireSeat(ctx, {
              gameId: current._id,
              userId,
              empireKey: getMissionPlayerSlotKey(mission.scenario),
            });
          }

          return {
            gameId: current._id,
            urlCode: current.urlCode ?? null,
            created: false as const,
          };
        }
      }

      if (
        args.restart === true &&
        (current.status === "lobby" || current.status === "running" || current.status === "paused")
      ) {
        await releaseUserFromGameForNewAttempt(ctx, { game: current, userId });
      }

      await ctx.db.patch("sim_games", current._id, {
        ownerUserId: null,
      });
    }

    const gameId: Id<"sim_games"> = await ctx.runMutation(api.sim.mutations.createGame, {
      name: mission.name,
      mapKey: mission.mapKey,
      mode: mission.mode,
      seed: `${mission.key}:${userId}:${Date.now()}`,
      npcEmpireKeys: listMissionSeededNpcPersonaKeys(mission.scenario),
      automatedEmpireKeys: listMissionAutomatedActorKeys(mission.scenario),
      missionKey: mission.key,
      lobbyScenarioKey: mission.key,
      retentionClass: mission.retentionClass,
    });

    return {
      gameId,
      urlCode: null,
      created: true as const,
    };
  },
});
