import { getAuthUserId } from "@convex-dev/auth/server";
import { query, type QueryCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { resolveLoadedGameMode } from "../sim/gameMode";
import { toAutomationStrategyCatalogRow } from "../usr/automationStrategyCatalog";
import { toMissionCatalogRow } from "../usr/missionCatalog";
import {
  getPublisherOwnerLabel,
  getPublisherViewer,
  resolvePublisherContentStatus,
  viewerHasPublisherRights,
} from "../usr/publisherAccess";

async function loadOwnerLabels(ctx: QueryCtx, ownerIds: Array<Id<"users"> | null>) {
  const uniqueOwnerIds = Array.from(new Set(ownerIds.filter((ownerId): ownerId is Id<"users"> => ownerId !== null)));
  const owners = await Promise.all(uniqueOwnerIds.map((ownerId) => ctx.db.get("users", ownerId)));
  return new Map(uniqueOwnerIds.map((ownerId, index) => [ownerId, getPublisherOwnerLabel(owners[index] ?? null)]));
}

export const getPublisherDashboard = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      return {
        authorized: false as const,
        canPublish: false as const,
        publishedCommunityMissions: [] as const,
        publishedCommunityStrategies: [] as const,
        myMissions: [] as const,
        myStrategies: [] as const,
      };
    }

    const viewer = await getPublisherViewer(ctx, userId);
    const canPublish = viewerHasPublisherRights(viewer);

    const [publishedCommunityMissionRows, publishedCommunityStrategyRows, myMissionRows, myStrategyRows, currentGames, memberships] = await Promise.all([
      ctx.db
        .query("sim_missions")
        .withIndex("by_source_and_status_and_sortOrder", (q) =>
          q.eq("source", "community").eq("status", "published"),
        )
        .collect(),
      ctx.db
        .query("usr_automation_strategies")
        .withIndex("by_source_and_status", (q) => q.eq("source", "community").eq("status", "published"))
        .collect(),
      canPublish
        ? ctx.db.query("sim_missions").withIndex("by_ownerUserId", (q) => q.eq("ownerUserId", userId)).collect()
        : Promise.resolve([]),
      canPublish
        ? ctx.db
            .query("usr_automation_strategies")
            .withIndex("by_ownerUserId", (q) => q.eq("ownerUserId", userId))
            .collect()
        : Promise.resolve([]),
      ctx.db
        .query("sim_games")
        .withIndex("by_ownerUserId", (q) => q.eq("ownerUserId", userId))
        .collect()
        .then((games) => Promise.all(games.map((game) => resolveLoadedGameMode(ctx, game))))
        .then((games) => games.filter((game): game is NonNullable<typeof game> => game !== null)),
      ctx.db
        .query("usr_game_roles")
        .withIndex("by_userId", (q) => q.eq("userId", userId))
        .collect(),
    ]);

    const visibleMyMissionRows = viewer.admin
      ? myMissionRows
      : myMissionRows.filter((row) => resolvePublisherContentStatus({ status: row.status, published: row.published }) !== "admin_deleted");
    const visibleMyStrategyRows = viewer.admin
      ? myStrategyRows
      : myStrategyRows.filter((row) => resolvePublisherContentStatus({ status: row.status }) !== "admin_deleted");

    const ownerLabels = await loadOwnerLabels(ctx, [
      ...publishedCommunityMissionRows.map((row) => row.ownerUserId ?? null),
      ...publishedCommunityStrategyRows.map((row) => row.ownerUserId ?? null),
      ...visibleMyMissionRows.map((row) => row.ownerUserId ?? null),
      ...visibleMyStrategyRows.map((row) => row.ownerUserId ?? null),
    ]);
    const communityGameByMissionKey = new Map(
      currentGames
        .map((game) => [game.missionKey ?? game.lobbyScenarioKey, game] as const)
        .filter(
          (entry): entry is [string, (typeof currentGames)[number]] =>
            entry[0] !== null && entry[0] !== undefined,
        ),
    );
    const membershipByGameId = new Map(
      memberships.map((membership) => [membership.gameId, membership] as const),
    );

    return {
      authorized: true as const,
      canPublish,
      viewer: {
        userId,
        admin: viewer.admin,
        publisher: viewer.publisher,
        plan: viewer.plan,
      },
      publishedCommunityMissions: publishedCommunityMissionRows
        .map((row) => ({
          ...toMissionCatalogRow(row),
          game: (() => {
            const game = communityGameByMissionKey.get(row.key) ?? null;
            if (game === null) {
              return null;
            }
            return {
              _id: game._id,
              urlCode: game.urlCode ?? null,
              status: game.status,
              startedAt: game.startedAt,
              endedAt: game.endedAt,
            };
          })(),
          isActiveMember: (() => {
            const game = communityGameByMissionKey.get(row.key) ?? null;
            if (game === null) {
              return false;
            }
            return membershipByGameId.get(game._id)?.isActive ?? false;
          })(),
          ownerLabel: row.ownerUserId === undefined || row.ownerUserId === null
            ? null
            : ownerLabels.get(row.ownerUserId) ?? null,
        }))
        .sort((left, right) => left.sortOrder - right.sortOrder || left.name.localeCompare(right.name)),
      publishedCommunityStrategies: publishedCommunityStrategyRows
        .map((row) => ({
          ...toAutomationStrategyCatalogRow(row),
          ownerLabel: row.ownerUserId === undefined || row.ownerUserId === null
            ? null
            : ownerLabels.get(row.ownerUserId) ?? null,
        }))
        .sort((left, right) => left.name.localeCompare(right.name)),
      myMissions: visibleMyMissionRows
        .map((row) => ({
          ...toMissionCatalogRow(row),
          ownerLabel: row.ownerUserId === undefined || row.ownerUserId === null
            ? null
            : ownerLabels.get(row.ownerUserId) ?? null,
        }))
        .sort((left, right) => right.updatedAt - left.updatedAt || left.name.localeCompare(right.name)),
      myStrategies: visibleMyStrategyRows
        .map((row) => ({
          ...toAutomationStrategyCatalogRow(row),
          ownerLabel: row.ownerUserId === undefined || row.ownerUserId === null
            ? null
            : ownerLabels.get(row.ownerUserId) ?? null,
        }))
        .sort((left, right) => right.updatedAt - left.updatedAt || left.name.localeCompare(right.name)),
    };
  },
});

export const listPublishedCommunityStrategies = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db
      .query("usr_automation_strategies")
      .withIndex("by_source_and_status", (q) => q.eq("source", "community").eq("status", "published"))
      .collect();
    return rows.map((row) => toAutomationStrategyCatalogRow(row)).sort((left, right) => left.name.localeCompare(right.name));
  },
});
