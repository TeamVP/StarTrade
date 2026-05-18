import { useDeferredValue, useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { Link } from "react-router-dom";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Card } from "@/components/ui/card";

type ModerationEvent = {
  action: "created" | "updated" | "bulk_status_updated" | "bulk_owner_updated" | "bulk_source_updated";
  summary: string;
  note: string | null;
  createdAt: number;
  actorLabel: string | null;
};

type QueueMissionRow = {
  key: string;
  name: string;
  description: string;
  ownerUserId: Id<"users"> | null;
  ownerLabel: string | null;
  source: "official" | "community";
  status: "draft" | "published" | "archived" | "deleted" | "admin_deleted";
  mode: "conquest_core" | "conquest_plus" | "trader_economy";
  requiredTier: "free" | "pro";
  updatedAt: number;
  moderationHistory: ModerationEvent[];
};

type QueueStrategyRow = {
  key: string;
  name: string;
  description: string;
  ownerUserId: Id<"users"> | null;
  ownerLabel: string | null;
  source: "official" | "community";
  status: "draft" | "published" | "archived" | "deleted" | "admin_deleted";
  updatedAt: number;
  moderationHistory: ModerationEvent[];
};

type QueueEntry = {
  kind: "mission" | "strategy";
  key: string;
  name: string;
  description: string;
  ownerUserId: Id<"users"> | null;
  ownerLabel: string | null;
  source: "official" | "community";
  status: "draft" | "published" | "archived" | "deleted" | "admin_deleted";
  updatedAt: number;
  moderationHistory: ModerationEvent[];
  metaLabel: string;
  destinationPath: "/admin/mission" | "/admin/strategies";
};

function buildCatalogLink(entry: QueueEntry) {
  const params = new URLSearchParams();
  params.set("search", entry.key);
  params.set("source", entry.source);
  params.set("status", entry.status);
  if (entry.ownerUserId === null) {
    params.set("owner", "system");
  }
  return {
    pathname: entry.destinationPath,
    search: `?${params.toString()}`,
  };
}

function formatTimestamp(value: number): string {
  return new Date(value).toLocaleString();
}

function normalizeSearchText(value: string): string {
  return value.trim().toLowerCase();
}

function latestModerationAt(entry: QueueEntry): number {
  return entry.moderationHistory[0]?.createdAt ?? entry.updatedAt;
}

function filterEntries(entries: QueueEntry[], searchText: string): QueueEntry[] {
  if (searchText.length === 0) {
    return entries;
  }
  return entries.filter((entry) =>
    [
      entry.kind,
      entry.key,
      entry.name,
      entry.description,
      entry.ownerLabel ?? "",
      entry.metaLabel,
      ...entry.moderationHistory.flatMap((event) => [event.summary, event.note ?? "", event.actorLabel ?? ""]),
    ]
      .join(" ")
      .toLowerCase()
      .includes(searchText),
  );
}

function QueueSection(props: {
  title: string;
  description: string;
  entries: QueueEntry[];
  emptyLabel: string;
}) {
  return (
    <Card className="space-y-3">
      <div>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-st-muted">{props.title}</h2>
        <p className="mt-1 text-sm text-st-muted">{props.description}</p>
      </div>

      {props.entries.length === 0 ? (
        <p className="text-sm text-st-muted">{props.emptyLabel}</p>
      ) : (
        <div className="space-y-3">
          {props.entries.map((entry) => {
            const latestEvent = entry.moderationHistory[0] ?? null;
            return (
              <div key={`${entry.kind}-${entry.key}`} className="rounded border border-st-border bg-st-bg/70 p-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded border border-st-border px-2 py-0.5 text-xs text-st-muted">{entry.kind}</span>
                      <h3 className="text-sm font-semibold text-st-fg">{entry.name}</h3>
                      <span className="rounded border border-st-border px-2 py-0.5 text-xs text-st-muted">{entry.key}</span>
                    </div>
                    <p className="mt-1 text-sm text-st-muted">{entry.description || "No description."}</p>
                    <p className="mt-1 text-xs text-st-muted">
                      Owner {entry.ownerLabel ?? entry.ownerUserId ?? "System"} · Updated {formatTimestamp(entry.updatedAt)}
                    </p>
                    <p className="mt-1 text-xs text-st-muted">{entry.metaLabel}</p>
                    {latestEvent !== null ? (
                      <div className="mt-2 text-xs text-st-muted">
                        <p>
                          Latest moderation: {formatTimestamp(latestEvent.createdAt)} · {latestEvent.actorLabel ?? "Unknown admin"} · {latestEvent.summary}
                        </p>
                        {latestEvent.note !== null ? <p className="text-st-fg">Note: {latestEvent.note}</p> : null}
                      </div>
                    ) : null}
                  </div>
                  <Link
                    to={buildCatalogLink(entry)}
                    className="rounded border border-st-border px-3 py-2 text-sm text-st-fg transition-colors hover:border-st-accent hover:bg-st-panel"
                  >
                    Open filtered catalog
                  </Link>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

export function AdminModerationPage() {
  const missionsQuery = useQuery(api.admin.queries.listMissions, {
    publishedOnly: false,
    fallbackToBuiltIns: false,
  });
  const strategiesQuery = useQuery(api.admin.queries.listAutomationStrategies, {});
  const [searchText, setSearchText] = useState("");
  const deferredSearchText = useDeferredValue(searchText);
  const normalizedSearchText = normalizeSearchText(deferredSearchText);

  const entries = useMemo(() => {
    const missionEntries: QueueEntry[] = missionsQuery?.authorized
      ? (missionsQuery.missions as QueueMissionRow[]).map((mission) => ({
          kind: "mission",
          key: mission.key,
          name: mission.name,
          description: mission.description,
          ownerUserId: mission.ownerUserId,
          ownerLabel: mission.ownerLabel,
          source: mission.source,
          status: mission.status,
          updatedAt: mission.updatedAt,
          moderationHistory: mission.moderationHistory,
          metaLabel: `${mission.mode} · ${mission.requiredTier}`,
          destinationPath: "/admin/mission",
        }))
      : [];
    const strategyEntries: QueueEntry[] = strategiesQuery?.authorized
      ? (strategiesQuery.strategies as QueueStrategyRow[]).map((strategy) => ({
          kind: "strategy",
          key: strategy.key,
          name: strategy.name,
          description: strategy.description,
          ownerUserId: strategy.ownerUserId,
          ownerLabel: strategy.ownerLabel,
          source: strategy.source,
          status: strategy.status,
          updatedAt: strategy.updatedAt,
          moderationHistory: strategy.moderationHistory,
          metaLabel: "Automation strategy",
          destinationPath: "/admin/strategies",
        }))
      : [];

    return [...missionEntries, ...strategyEntries];
  }, [missionsQuery, strategiesQuery]);

  const actionableCommunityEntries = useMemo(
    () =>
      entries.filter(
        (entry) =>
          entry.source === "community" &&
          (entry.status === "draft" || entry.status === "published"),
      ),
    [entries],
  );

  const draftEntries = useMemo(
    () =>
      filterEntries(
        actionableCommunityEntries
          .filter((entry) => entry.status === "draft")
          .sort((left, right) => latestModerationAt(right) - latestModerationAt(left)),
        normalizedSearchText,
      ),
    [actionableCommunityEntries, normalizedSearchText],
  );

  const ownerlessEntries = useMemo(
    () =>
      filterEntries(
        actionableCommunityEntries
          .filter((entry) => entry.ownerUserId === null)
          .sort((left, right) => latestModerationAt(right) - latestModerationAt(left)),
        normalizedSearchText,
      ),
    [actionableCommunityEntries, normalizedSearchText],
  );

  const recentReviewEntries = useMemo(
    () =>
      filterEntries(
        actionableCommunityEntries
          .slice()
          .sort((left, right) => latestModerationAt(right) - latestModerationAt(left))
          .slice(0, 12),
        normalizedSearchText,
      ),
    [actionableCommunityEntries, normalizedSearchText],
  );

  if (missionsQuery === undefined || strategiesQuery === undefined) {
    return (
      <div className="mx-auto max-w-[86.4rem] px-4 py-6">
        <Card className="text-sm text-st-muted">Loading moderation queue...</Card>
      </div>
    );
  }

  if (!missionsQuery.authorized || !strategiesQuery.authorized) {
    return (
      <div className="mx-auto max-w-[86.4rem] px-4 py-6">
        <Card className="text-sm text-st-muted">Sign in as an admin to review community content.</Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[86.4rem] space-y-6 px-4 py-6">
      <Card className="space-y-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-st-muted">Admin</p>
          <h1 className="text-2xl font-semibold text-st-fg">Moderation Queue</h1>
          <p className="mt-2 text-sm text-st-muted">
            Review community missions and strategies that are still actionable, with draft, ownerless, and recently moderated queues built from the shared catalogs.
          </p>
        </div>

        <div className="grid gap-3 lg:grid-cols-[minmax(0,2fr)_repeat(3,minmax(0,1fr))]">
          <input
            value={searchText}
            onChange={(event) => setSearchText(event.target.value)}
            placeholder="Search keys, names, owners, or moderation notes"
            className="rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-fg"
          />
          <div className="rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-muted">
            Actionable community: <span className="font-medium text-st-fg">{actionableCommunityEntries.length}</span>
          </div>
          <div className="rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-muted">
            Drafts: <span className="font-medium text-st-fg">{draftEntries.length}</span>
          </div>
          <div className="rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-muted">
            Ownerless: <span className="font-medium text-st-fg">{ownerlessEntries.length}</span>
          </div>
        </div>
      </Card>

      <QueueSection
        title="Draft Review"
        description="Community draft rows are the clearest first-pass moderation queue because they are not yet public but are already actionable."
        entries={draftEntries}
        emptyLabel="No draft community rows match the current search."
      />

      <QueueSection
        title="Ownerless Community Content"
        description="Community rows without an explicit owner are harder to triage and usually need reassignment or cleanup before broader moderation work."
        entries={ownerlessEntries}
        emptyLabel="No ownerless community rows match the current search."
      />

      <QueueSection
        title="Recent Community Activity"
        description="The most recently moderated or updated community rows are surfaced here for follow-up review without scanning the full catalogs."
        entries={recentReviewEntries}
        emptyLabel="No recent community moderation rows match the current search."
      />
    </div>
  );
}