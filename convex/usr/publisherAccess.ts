import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

export type PublisherContentSource = "official" | "community";
export type PublisherContentStatus =
  | "draft"
  | "published"
  | "archived"
  | "deleted"
  | "admin_deleted";

export type PublisherViewer = {
  userId: Id<"users">;
  admin: boolean;
  publisher: boolean;
  plan: "free" | "pro";
};

type DbCtx = { db: QueryCtx["db"] | MutationCtx["db"] };

export function resolvePublisherContentSource(
  source: PublisherContentSource | undefined,
): PublisherContentSource {
  return source ?? "official";
}

export function resolvePublisherContentStatus(args: {
  status: PublisherContentStatus | undefined;
  published?: boolean | null;
  defaultDraft?: boolean;
}): PublisherContentStatus {
  if (args.status !== undefined) {
    return args.status;
  }
  if (args.published !== undefined && args.published !== null) {
    return args.published ? "published" : "draft";
  }
  return args.defaultDraft === true ? "draft" : "published";
}

export function isPublishedContentStatus(status: PublisherContentStatus): boolean {
  return status === "published";
}

export function isTerminalContentStatus(status: PublisherContentStatus): boolean {
  return status === "archived" || status === "deleted" || status === "admin_deleted";
}

export function viewerHasPublisherRights(viewer: Pick<PublisherViewer, "admin" | "publisher">): boolean {
  return viewer.admin || viewer.publisher;
}

export function viewerCanManageOwnedContent(
  viewer: Pick<PublisherViewer, "userId" | "admin">,
  ownerUserId: Id<"users"> | null | undefined,
): boolean {
  return viewer.admin || (ownerUserId !== null && ownerUserId !== undefined && ownerUserId === viewer.userId);
}

export function assertMayTransitionContentStatus(args: {
  currentStatus: PublisherContentStatus;
  nextStatus: PublisherContentStatus;
  isAdmin: boolean;
}): void {
  if (args.currentStatus === args.nextStatus) {
    return;
  }
  if (isTerminalContentStatus(args.currentStatus)) {
    throw new Error("This content is in a terminal status and can no longer be edited.");
  }
  if (args.nextStatus === "admin_deleted" && !args.isAdmin) {
    throw new Error("Only admins can set admin-deleted status.");
  }
}

export async function getPublisherViewer(
  ctx: DbCtx,
  userId: Id<"users">,
): Promise<PublisherViewer> {
  const user = await ctx.db.get("users", userId);
  if (user === null) {
    throw new Error("User not found.");
  }
  return {
    userId,
    admin: user.admin ?? false,
    publisher: user.publisher ?? false,
    plan: user.plan ?? "free",
  };
}

export function getPublisherOwnerLabel(user: Doc<"users"> | null): string | null {
  if (user === null) {
    return null;
  }
  return user.name?.trim() || user.email?.trim() || null;
}