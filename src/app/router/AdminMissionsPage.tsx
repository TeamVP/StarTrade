import { useDeferredValue, useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

type MissionPreview = {
  playerSlotKey: string;
  slotCount: number;
  npcControlledCount: number;
  delayedAutomationCount: number;
  handicapCount: number;
  fightAttractionCount: number;
  intruderDetectionCount: number;
};

type MissionRow = {
  key: string;
  name: string;
  description: string;
  mapKey: string;
  ownerUserId: Id<"users"> | null;
  ownerLabel: string | null;
  source: "official" | "community";
  reviewStatus: "unreviewed" | "needs_changes" | "approved";
  status: "draft" | "published" | "archived" | "deleted" | "admin_deleted";
  mode: "conquest_core" | "conquest_plus" | "trader_economy";
  requiredTier: "free" | "pro";
  mapTier: "small" | "medium" | "large";
  level: number;
  requiredWins: number;
  prerequisiteMissionKeys: string[];
  published: boolean;
  sortOrder: number;
  retentionClass: "discarded" | "official" | "archived_debug";
  scenarioJson: string;
  preview: MissionPreview;
  moderationHistory: Array<{
    action: "created" | "updated" | "bulk_status_updated" | "bulk_owner_updated" | "bulk_source_updated";
    summary: string;
    note: string | null;
    createdAt: number;
    actorLabel: string | null;
  }>;
  createdAt: number;
  updatedAt: number;
};

type AssignableOwnerRow = {
  _id: Id<"users">;
  name: string | null;
  email: string | null;
  admin: boolean;
  publisher: boolean;
};

function ownerOptionLabel(owner: AssignableOwnerRow): string {
  return owner.name?.trim() || owner.email?.trim() || owner._id;
}

function statusTone(status: MissionRow["status"]): string {
  switch (status) {
    case "published":
      return "border-emerald-500/40 bg-emerald-950/30 text-emerald-200";
    case "draft":
      return "border-amber-500/40 bg-amber-950/30 text-amber-200";
    case "archived":
      return "border-slate-500/40 bg-slate-900/40 text-slate-200";
    case "deleted":
    case "admin_deleted":
      return "border-red-500/40 bg-red-950/30 text-red-200";
    default:
      return "border-st-border text-st-muted";
  }
}

function reviewTone(reviewStatus: MissionRow["reviewStatus"]): string {
  switch (reviewStatus) {
    case "approved":
      return "border-emerald-500/40 bg-emerald-950/30 text-emerald-200";
    case "needs_changes":
      return "border-rose-500/40 bg-rose-950/30 text-rose-200";
    case "unreviewed":
    default:
      return "border-amber-500/40 bg-amber-950/30 text-amber-200";
  }
}

function mutationErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  return raw.replace(/^[\s\S]*?Error:\s*/g, "").trim() || "Something went wrong.";
}


function normalizeSearchText(value: string): string {
  return value.trim().toLowerCase();
}

function readMissionSourceFilter(value: string | null): "all" | MissionRow["source"] {
  return value === "official" || value === "community" ? value : "all";
}

function readMissionStatusFilter(value: string | null): "all" | MissionRow["status"] {
  return value === "draft" ||
    value === "published" ||
    value === "archived" ||
    value === "deleted" ||
    value === "admin_deleted"
    ? value
    : "all";
}

function readMissionOwnerFilter(value: string | null): "all" | "system" | Id<"users"> {
  if (value === "all" || value === null || value.trim().length === 0) {
    return "all";
  }
  if (value === "system") {
    return "system";
  }
  return value as Id<"users">;
}

function readMissionReviewFilter(value: string | null): "all" | MissionRow["reviewStatus"] {
  return value === "unreviewed" || value === "needs_changes" || value === "approved"
    ? value
    : "all";
}

function readMissionModeFilter(value: string | null): "all" | MissionRow["mode"] {
  return value === "conquest_core" || value === "conquest_plus" || value === "trader_economy"
    ? value
    : "all";
}

const MODERATION_NOTE_PRESETS = [
  "Approved after moderation review.",
  "Needs changes before approval.",
  "Metadata normalized for catalog consistency.",
  "Ownership/source updated by admin moderation.",
] as const;

function applyModerationNotePreset(currentNote: string, preset: string): string {
  const trimmed = currentNote.trim();
  if (trimmed.length === 0) {
    return preset;
  }
  if (trimmed.includes(preset)) {
    return currentNote;
  }
  return `${trimmed}\n${preset}`;
}

function ModerationNotePresets(props: {
  disabled?: boolean;
  onSelect: (preset: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {MODERATION_NOTE_PRESETS.map((preset) => (
        <Button
          key={preset}
          type="button"
          variant="outline"
          disabled={props.disabled}
          onClick={() => props.onSelect(preset)}
          className="h-auto px-2 py-1 text-[11px]"
        >
          {preset}
        </Button>
      ))}
    </div>
  );
}

function MissionCard(props: {
  mission: MissionRow;
  selected: boolean;
  onToggleSelect: (key: string) => void;
}) {
  return (
    <Card className="space-y-0">
      {/* Compact view row */}
      <div className="flex items-start gap-3 px-0.5 py-0.5">
        <input
          type="checkbox"
          checked={props.selected}
          onChange={() => props.onToggleSelect(props.mission.key)}
          className="mt-4.5 ml-0.5 shrink-0 accent-cyan-400"
          aria-label={`Select ${props.mission.key}`}
        />
        <div className="min-w-0 flex-1 py-3">
          {/* Title row */}
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <h3 className="text-sm font-semibold text-st-fg">{props.mission.name}</h3>
            <span className="text-xs text-st-muted">{props.mission.key}</span>
            <span className="text-xs text-st-muted">·</span>
            <span className="text-xs text-st-muted">Lv {props.mission.level}</span>
            <span className="text-xs text-st-muted">·</span>
            <span className="text-xs text-st-muted">{props.mission.mapKey}</span>
            <span className="text-xs text-st-muted">·</span>
            <span className={`rounded border px-1.5 py-0.5 text-[11px] ${props.mission.source === "community" ? "border-sky-500/40 bg-sky-950/30 text-sky-200" : "border-st-border text-st-muted"}`}>
              {props.mission.source}
            </span>
            <span className={`rounded border px-1.5 py-0.5 text-[11px] ${reviewTone(props.mission.reviewStatus)}`}>
              {props.mission.reviewStatus}
            </span>
            <span className={`rounded border px-1.5 py-0.5 text-[11px] ${statusTone(props.mission.status)}`}>
              {props.mission.status}
            </span>
          </div>
          {/* Description */}
          {props.mission.description && (
            <p className="mt-1 text-xs text-st-muted line-clamp-2">{props.mission.description}</p>
          )}
          {/* Slot summary chips */}
          <div className="mt-2 flex flex-wrap gap-1.5">
            {props.mission.preview.slotCount > 0 && (
              <span className="rounded-full border border-st-border bg-st-bg px-2 py-0.5 text-[11px] text-st-muted">
                {props.mission.preview.slotCount} slots
              </span>
            )}
            {props.mission.preview.npcControlledCount > 0 && (
              <span className="rounded-full border border-st-border bg-st-bg px-2 py-0.5 text-[11px] text-st-muted">
                {props.mission.preview.npcControlledCount} NPC-controlled
              </span>
            )}
            {props.mission.preview.delayedAutomationCount > 0 && (
              <span className="rounded-full border border-amber-800/40 bg-amber-950/20 px-2 py-0.5 text-[11px] text-amber-300/80">
                {props.mission.preview.delayedAutomationCount} delayed AI
              </span>
            )}
            {props.mission.preview.handicapCount > 0 && (
              <span className="rounded-full border border-rose-800/40 bg-rose-950/20 px-2 py-0.5 text-[11px] text-rose-300/80">
                {props.mission.preview.handicapCount} handicapped
              </span>
            )}
            {props.mission.preview.fightAttractionCount > 0 && (
              <span className="rounded-full border border-st-border bg-st-bg px-2 py-0.5 text-[11px] text-st-muted">
                {props.mission.preview.fightAttractionCount} fight attraction
              </span>
            )}
            {props.mission.preview.intruderDetectionCount > 0 && (
              <span className="rounded-full border border-st-border bg-st-bg px-2 py-0.5 text-[11px] text-st-muted">
                {props.mission.preview.intruderDetectionCount} intruder detect
              </span>
            )}
          </div>
        </div>
        <div className="shrink-0 py-3">
          <Link
            to={`/admin/mission/${props.mission.key}`}
            className="inline-flex items-center rounded border border-st-border bg-transparent px-3 py-2 text-sm text-st-fg hover:bg-st-border"
          >
            Edit
          </Link>
        </div>
      </div>

    </Card>
  );
}


export function AdminMissionsPage() {
  const [searchParams] = useSearchParams();
  const missionsQuery = useQuery(api.admin.queries.listMissions, {
    publishedOnly: false,
    fallbackToBuiltIns: false,
  });
  const usersQuery = useQuery(api.admin.queries.listUsers, { limit: 256 });
  const bulkUpdateMissionStatus = useMutation(api.admin.mutations.bulkUpdateMissionStatus);
  const bulkUpdateMissionReviewStatus = useMutation(api.admin.mutations.bulkUpdateMissionReviewStatus);
  const bulkUpdateMissionOwner = useMutation(api.admin.mutations.bulkUpdateMissionOwner);
  const bulkUpdateMissionSource = useMutation(api.admin.mutations.bulkUpdateMissionSource);
  const [searchText, setSearchText] = useState(() => searchParams.get("search") ?? "");
  const [sourceFilter, setSourceFilter] = useState<"all" | MissionRow["source"]>(() =>
    readMissionSourceFilter(searchParams.get("source")),
  );
  const [statusFilter, setStatusFilter] = useState<"all" | MissionRow["status"]>(() =>
    readMissionStatusFilter(searchParams.get("status")),
  );
  const [reviewFilter, setReviewFilter] = useState<"all" | MissionRow["reviewStatus"]>(() =>
    readMissionReviewFilter(searchParams.get("review")),
  );
  const [modeFilter, setModeFilter] = useState<"all" | MissionRow["mode"]>(() =>
    readMissionModeFilter(searchParams.get("mode")),
  );
  const [ownerFilter, setOwnerFilter] = useState<"all" | "system" | Id<"users">>(() =>
    readMissionOwnerFilter(searchParams.get("owner")),
  );
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [bulkStatus, setBulkStatus] = useState<MissionRow["status"]>("archived");
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkResult, setBulkResult] = useState<string | null>(null);
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [bulkReviewStatus, setBulkReviewStatus] = useState<MissionRow["reviewStatus"]>("approved");
  const [bulkReviewBusy, setBulkReviewBusy] = useState(false);
  const [bulkReviewResult, setBulkReviewResult] = useState<string | null>(null);
  const [bulkReviewError, setBulkReviewError] = useState<string | null>(null);
  const [bulkOwnerUserId, setBulkOwnerUserId] = useState<Id<"users"> | "">("");
  const [bulkOwnerBusy, setBulkOwnerBusy] = useState(false);
  const [bulkOwnerResult, setBulkOwnerResult] = useState<string | null>(null);
  const [bulkOwnerError, setBulkOwnerError] = useState<string | null>(null);
  const [bulkSource, setBulkSource] = useState<MissionRow["source"]>("community");
  const [bulkSourceBusy, setBulkSourceBusy] = useState(false);
  const [bulkSourceResult, setBulkSourceResult] = useState<string | null>(null);
  const [bulkSourceError, setBulkSourceError] = useState<string | null>(null);
  const [bulkModerationNote, setBulkModerationNote] = useState("");

  const missions = useMemo(
    () => (missionsQuery?.authorized ? (missionsQuery.missions as MissionRow[]) : []),
    [missionsQuery],
  );
  const deferredSearchText = useDeferredValue(searchText);
  const normalizedSearchText = normalizeSearchText(deferredSearchText);
  const selectedKeySet = useMemo(() => new Set(selectedKeys), [selectedKeys]);
  const ownerOptions = useMemo(
    () =>
      usersQuery?.authorized
        ? (usersQuery.users as AssignableOwnerRow[])
            .filter((user) => user.admin || user.publisher)
            .sort((left, right) => ownerOptionLabel(left).localeCompare(ownerOptionLabel(right)))
        : [],
    [usersQuery],
  );
  const filteredMissions = useMemo(
    () =>
      missions.filter((mission) => {
        if (sourceFilter !== "all" && mission.source !== sourceFilter) {
          return false;
        }
        if (statusFilter !== "all" && mission.status !== statusFilter) {
          return false;
        }
        if (reviewFilter !== "all" && mission.reviewStatus !== reviewFilter) {
          return false;
        }
        if (modeFilter !== "all" && mission.mode !== modeFilter) {
          return false;
        }
        if (ownerFilter === "system" && mission.ownerUserId !== null) {
          return false;
        }
        if (ownerFilter !== "all" && ownerFilter !== "system" && mission.ownerUserId !== ownerFilter) {
          return false;
        }
        if (normalizedSearchText.length === 0) {
          return true;
        }
        return [
          mission.key,
          mission.name,
          mission.description,
          mission.mapKey,
          mission.ownerLabel ?? "",
          mission.mode,
          mission.requiredTier,
        ]
          .join(" ")
          .toLowerCase()
          .includes(normalizedSearchText);
      }),
    [missions, sourceFilter, statusFilter, reviewFilter, modeFilter, ownerFilter, normalizedSearchText],
  );
  const missionSummary = useMemo(
    () => ({
      official: missions.filter((mission) => mission.source === "official").length,
      community: missions.filter((mission) => mission.source === "community").length,
      unreviewed: missions.filter((mission) => mission.reviewStatus === "unreviewed").length,
      needsChanges: missions.filter((mission) => mission.reviewStatus === "needs_changes").length,
      approved: missions.filter((mission) => mission.reviewStatus === "approved").length,
      ownerlessCommunity: missions.filter(
        (mission) => mission.source === "community" && mission.ownerUserId === null,
      ).length,
      conquestCore: missions.filter((mission) => mission.mode === "conquest_core").length,
      traderEconomy: missions.filter((mission) => mission.mode === "trader_economy").length,
    }),
    [missions],
  );
  const visibleKeys = useMemo(() => filteredMissions.map((mission) => mission.key), [filteredMissions]);
  const selectedVisibleCount = useMemo(
    () => visibleKeys.filter((key) => selectedKeySet.has(key)).length,
    [visibleKeys, selectedKeySet],
  );
  const allVisibleSelected = visibleKeys.length > 0 && selectedVisibleCount === visibleKeys.length;

  function clearBulkFeedback() {
    setBulkResult(null);
    setBulkError(null);
    setBulkReviewResult(null);
    setBulkReviewError(null);
    setBulkOwnerResult(null);
    setBulkOwnerError(null);
    setBulkSourceResult(null);
    setBulkSourceError(null);
  }

  function toggleSelectedKey(key: string) {
    clearBulkFeedback();
    setSelectedKeys((current) => (current.includes(key) ? current.filter((value) => value !== key) : [...current, key]));
  }

  function toggleSelectVisible() {
    clearBulkFeedback();
    setSelectedKeys((current) => {
      const next = new Set(current);
      if (allVisibleSelected) {
        for (const key of visibleKeys) {
          next.delete(key);
        }
      } else {
        for (const key of visibleKeys) {
          next.add(key);
        }
      }
      return Array.from(next);
    });
  }

  async function handleBulkStatusUpdate() {
    clearBulkFeedback();
    if (selectedKeys.length === 0) {
      setBulkError("Select at least one mission first.");
      setBulkResult(null);
      return;
    }

    setBulkBusy(true);
    setBulkResult(null);
    setBulkError(null);
    try {
      const result = await bulkUpdateMissionStatus({
        keys: selectedKeys,
        status: bulkStatus,
        moderationNote: bulkModerationNote,
      });
      setBulkResult(`Updated ${result.updatedKeys.length} missions. Skipped ${result.skippedKeys.length}.`);
      setBulkModerationNote("");
      setSelectedKeys([]);
    } catch (error) {
      setBulkError(mutationErrorMessage(error));
    } finally {
      setBulkBusy(false);
    }
  }

  async function handleBulkOwnerUpdate() {
    clearBulkFeedback();
    if (selectedKeys.length === 0) {
      setBulkOwnerError("Select at least one mission first.");
      setBulkOwnerResult(null);
      return;
    }

    setBulkOwnerBusy(true);
    setBulkOwnerResult(null);
    setBulkOwnerError(null);
    try {
      const result = await bulkUpdateMissionOwner({
        keys: selectedKeys,
        ownerUserId: bulkOwnerUserId || null,
        moderationNote: bulkModerationNote,
      });
      setBulkOwnerResult(`Updated ${result.updatedKeys.length} mission owners. Skipped ${result.skippedKeys.length}.`);
      setBulkModerationNote("");
      setSelectedKeys([]);
    } catch (error) {
      setBulkOwnerError(mutationErrorMessage(error));
    } finally {
      setBulkOwnerBusy(false);
    }
  }

  async function handleBulkReviewUpdate() {
    clearBulkFeedback();
    if (selectedKeys.length === 0) {
      setBulkReviewError("Select at least one mission first.");
      setBulkReviewResult(null);
      return;
    }

    setBulkReviewBusy(true);
    setBulkReviewResult(null);
    setBulkReviewError(null);
    try {
      const result = await bulkUpdateMissionReviewStatus({
        keys: selectedKeys,
        reviewStatus: bulkReviewStatus,
        moderationNote: bulkModerationNote,
      });
      setBulkReviewResult(`Updated ${result.updatedKeys.length} mission review states. Skipped ${result.skippedKeys.length}.`);
      setBulkModerationNote("");
      setSelectedKeys([]);
    } catch (error) {
      setBulkReviewError(mutationErrorMessage(error));
    } finally {
      setBulkReviewBusy(false);
    }
  }

  async function handleBulkSourceUpdate() {
    clearBulkFeedback();
    if (selectedKeys.length === 0) {
      setBulkSourceError("Select at least one mission first.");
      setBulkSourceResult(null);
      return;
    }

    setBulkSourceBusy(true);
    setBulkSourceResult(null);
    setBulkSourceError(null);
    try {
      const result = await bulkUpdateMissionSource({
        keys: selectedKeys,
        source: bulkSource,
        moderationNote: bulkModerationNote,
      });
      setBulkSourceResult(`Updated ${result.updatedKeys.length} mission sources. Skipped ${result.skippedKeys.length}.`);
      setBulkModerationNote("");
      if (bulkSource === "official") {
        setBulkOwnerUserId("");
      }
      setSelectedKeys([]);
    } catch (error) {
      setBulkSourceError(mutationErrorMessage(error));
    } finally {
      setBulkSourceBusy(false);
    }
  }

  if (missionsQuery === undefined || usersQuery === undefined) {
    return (
      <div className="mx-auto max-w-[86.4rem] px-4 py-6">
        <Card className="text-sm text-st-muted">Loading missions...</Card>
      </div>
    );
  }

  if (!missionsQuery.authorized) {
    return (
      <div className="mx-auto max-w-[86.4rem] px-4 py-6">
        <Card className="text-sm text-st-muted">Sign in to manage missions.</Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[86.4rem] space-y-6 px-4 py-6">
      <Card className="space-y-4">
        {/* Page header */}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-st-muted">Admin</p>
            <h1 className="text-2xl font-semibold text-st-fg">Missions</h1>
            <p className="mt-2 max-w-3xl text-sm text-st-muted">
              Edit the mission catalog that drives player progression. Each mission record controls map choice,
              sequencing, required wins, and scenario JSON for player empire, NPC strategy activation, and handicaps.
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Link
              to="/admin/mission/create"
              className="rounded border border-st-border px-3 py-1.5 text-xs text-st-muted hover:border-st-accent/40 hover:text-st-fg"
            >
              + New mission
            </Link>
            <span className="rounded border border-st-border px-3 py-1.5 text-xs text-st-muted tabular-nums">
              {filteredMissions.length} / {missions.length} missions
            </span>
          </div>
        </div>

        {/* Search & filter bar */}
        <div className="grid gap-2 md:grid-cols-[minmax(0,2fr)_repeat(2,minmax(0,1fr))] xl:grid-cols-[minmax(0,3fr)_repeat(5,minmax(0,1fr))]">
          <input
            value={searchText}
            onChange={(event) => setSearchText(event.target.value)}
            placeholder="Search key, name, description, map, owner, or mode"
            className="rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-fg placeholder:text-st-muted outline-none focus:border-st-accent"
          />
          <select
            value={sourceFilter}
            onChange={(event) => {
              setSourceFilter(event.target.value as typeof sourceFilter);
            }}
            className="rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-fg outline-none focus:border-st-accent"
          >
            <option value="all">All sources</option>
            <option value="official">Official</option>
            <option value="community">Community</option>
          </select>
          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}
            className="rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-fg outline-none focus:border-st-accent"
          >
            <option value="all">All statuses</option>
            <option value="draft">Draft</option>
            <option value="published">Published</option>
            <option value="archived">Archived</option>
            <option value="deleted">Deleted</option>
            <option value="admin_deleted">Admin deleted</option>
          </select>
          <select
            value={reviewFilter}
            onChange={(event) => setReviewFilter(event.target.value as typeof reviewFilter)}
            className="rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-fg outline-none focus:border-st-accent"
          >
            <option value="all">All review states</option>
            <option value="unreviewed">Unreviewed</option>
            <option value="needs_changes">Needs changes</option>
            <option value="approved">Approved</option>
          </select>
          <select
            value={modeFilter}
            onChange={(event) => setModeFilter(event.target.value as typeof modeFilter)}
            className="rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-fg outline-none focus:border-st-accent"
          >
            <option value="all">All modes</option>
            <option value="conquest_core">Conquest core</option>
            <option value="conquest_plus">Conquest plus</option>
            <option value="trader_economy">Trader economy</option>
          </select>
          <select
            value={ownerFilter}
            onChange={(event) => setOwnerFilter(event.target.value as typeof ownerFilter)}
            className="rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-fg outline-none focus:border-st-accent"
          >
            <option value="all">All owners</option>
            <option value="system">System / unowned</option>
            {ownerOptions.map((owner) => (
              <option key={owner._id} value={owner._id}>
                {ownerOptionLabel(owner)}
              </option>
            ))}
          </select>
        </div>

        {/* Quick-filter stat chips — clickable to apply / toggle filters */}
        <div className="flex flex-wrap items-center gap-1.5">
          {([
            {
              label: "Official",
              count: missionSummary.official,
              active: sourceFilter === "official",
              onClick: () => setSourceFilter(sourceFilter === "official" ? "all" : "official"),
            },
            {
              label: "Community",
              count: missionSummary.community,
              active: sourceFilter === "community",
              onClick: () => setSourceFilter(sourceFilter === "community" ? "all" : "community"),
            },
            {
              label: "Unreviewed",
              count: missionSummary.unreviewed,
              active: reviewFilter === "unreviewed",
              accent: missionSummary.unreviewed > 0 ? "amber" : undefined,
              onClick: () => setReviewFilter(reviewFilter === "unreviewed" ? "all" : "unreviewed"),
            },
            {
              label: "Needs changes",
              count: missionSummary.needsChanges,
              active: reviewFilter === "needs_changes",
              accent: missionSummary.needsChanges > 0 ? "rose" : undefined,
              onClick: () => setReviewFilter(reviewFilter === "needs_changes" ? "all" : "needs_changes"),
            },
            {
              label: "Approved",
              count: missionSummary.approved,
              active: reviewFilter === "approved",
              accent: "emerald" as const,
              onClick: () => setReviewFilter(reviewFilter === "approved" ? "all" : "approved"),
            },
            {
              label: "Ownerless community",
              count: missionSummary.ownerlessCommunity,
              active: sourceFilter === "community" && ownerFilter === "system",
              accent: missionSummary.ownerlessCommunity > 0 ? "amber" : undefined,
              onClick: () => {
                const isActive = sourceFilter === "community" && ownerFilter === "system";
                setSourceFilter(isActive ? "all" : "community");
                setOwnerFilter(isActive ? "all" : "system");
              },
            },
            {
              label: "Conquest core",
              count: missionSummary.conquestCore,
              active: modeFilter === "conquest_core",
              onClick: () => setModeFilter(modeFilter === "conquest_core" ? "all" : "conquest_core"),
            },
            {
              label: "Trader economy",
              count: missionSummary.traderEconomy,
              active: modeFilter === "trader_economy",
              accent: "sky" as const,
              onClick: () => setModeFilter(modeFilter === "trader_economy" ? "all" : "trader_economy"),
            },
          ] as Array<{
            label: string;
            count: number;
            active: boolean;
            accent?: "amber" | "rose" | "emerald" | "sky";
            onClick: () => void;
          }>).map((chip) => {
            const accentClass =
              chip.active
                ? chip.accent === "amber"
                  ? "border-amber-500/60 bg-amber-950/50 text-amber-200"
                  : chip.accent === "rose"
                    ? "border-rose-500/60 bg-rose-950/50 text-rose-200"
                    : chip.accent === "emerald"
                      ? "border-emerald-500/60 bg-emerald-950/50 text-emerald-200"
                      : chip.accent === "sky"
                        ? "border-sky-500/60 bg-sky-950/50 text-sky-200"
                        : "border-st-accent/60 bg-st-accent/10 text-st-fg"
                : chip.accent === "amber" && chip.count > 0
                  ? "border-amber-800/40 bg-st-bg text-amber-300/80 hover:border-amber-600/60 hover:bg-amber-950/30"
                  : chip.accent === "rose" && chip.count > 0
                    ? "border-rose-800/40 bg-st-bg text-rose-300/80 hover:border-rose-600/60 hover:bg-rose-950/30"
                    : "border-st-border bg-st-bg text-st-muted hover:border-st-accent/40 hover:text-st-fg";
            return (
              <button
                key={chip.label}
                type="button"
                onClick={chip.onClick}
                className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs transition-colors cursor-pointer ${accentClass}`}
              >
                <span>{chip.label}</span>
                <span className={`font-semibold tabular-nums ${chip.active ? "" : "opacity-70"}`}>{chip.count}</span>
              </button>
            );
          })}
        </div>

        {/* Selection toolbar — always visible, shows Select all visible shortcut */}
        <div className="flex items-center justify-between gap-3 border-t border-st-border/50 pt-3">
          <p className="text-xs text-st-muted">
            {selectedKeys.length === 0
              ? `${filteredMissions.length} mission${filteredMissions.length !== 1 ? "s" : ""} visible`
              : `${selectedKeys.length} selected · ${selectedVisibleCount} visible`}
          </p>
          <div className="flex gap-2">
            {selectedKeys.length > 0 && (
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  clearBulkFeedback();
                  setSelectedKeys([]);
                }}
              >
                Clear selection
              </Button>
            )}
            <Button
              type="button"
              variant="secondary"
              onClick={toggleSelectVisible}
              disabled={visibleKeys.length === 0}
            >
              {allVisibleSelected ? "Deselect visible" : "Select all visible"}
            </Button>
          </div>
        </div>

        {/* Bulk actions panel — only shown when items are selected */}
        {selectedKeys.length > 0 && (
          <div className="space-y-4 rounded-lg border border-cyan-700/30 bg-cyan-950/15 p-4">
            <div className="flex items-center gap-2">
              <div className="h-1.5 w-1.5 rounded-full bg-cyan-400" />
              <h3 className="text-sm font-semibold text-cyan-200">
                Bulk actions — {selectedKeys.length} mission{selectedKeys.length !== 1 ? "s" : ""}
              </h3>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              {/* Lifecycle status */}
              <div className="space-y-1.5">
                <div>
                  <p className="text-xs font-semibold text-st-fg">Lifecycle status</p>
                  <p className="text-xs text-st-muted">Move missions through draft → published → archived lifecycle.</p>
                </div>
                <div className="flex gap-2">
                  <select
                    value={bulkStatus}
                    onChange={(event) => setBulkStatus(event.target.value as MissionRow["status"])}
                    className="min-w-0 flex-1 rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-fg outline-none focus:border-st-accent"
                  >
                    <option value="draft">Draft</option>
                    <option value="published">Published</option>
                    <option value="archived">Archived</option>
                    <option value="deleted">Deleted</option>
                    <option value="admin_deleted">Admin deleted</option>
                  </select>
                  <Button type="button" onClick={() => void handleBulkStatusUpdate()} disabled={bulkBusy}>
                    {bulkBusy ? "Applying…" : "Apply"}
                  </Button>
                </div>
                {bulkResult !== null && <p className="text-xs text-emerald-300">{bulkResult}</p>}
                {bulkError !== null && <p className="text-xs text-red-300">{bulkError}</p>}
              </div>

              {/* Review state */}
              <div className="space-y-1.5">
                <div>
                  <p className="text-xs font-semibold text-st-fg">Review state</p>
                  <p className="text-xs text-st-muted">Official missions only accept <em>approved</em>; other states are skipped.</p>
                </div>
                <div className="flex gap-2">
                  <select
                    value={bulkReviewStatus}
                    onChange={(event) => setBulkReviewStatus(event.target.value as MissionRow["reviewStatus"])}
                    className="min-w-0 flex-1 rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-fg outline-none focus:border-st-accent"
                  >
                    <option value="unreviewed">Unreviewed</option>
                    <option value="needs_changes">Needs changes</option>
                    <option value="approved">Approved</option>
                  </select>
                  <Button type="button" onClick={() => void handleBulkReviewUpdate()} disabled={bulkReviewBusy}>
                    {bulkReviewBusy ? "Applying…" : "Apply"}
                  </Button>
                </div>
                {bulkReviewResult !== null && <p className="text-xs text-emerald-300">{bulkReviewResult}</p>}
                {bulkReviewError !== null && <p className="text-xs text-red-300">{bulkReviewError}</p>}
              </div>

              {/* Assign owner */}
              <div className="space-y-1.5">
                <div>
                  <p className="text-xs font-semibold text-st-fg">Assign owner</p>
                  <p className="text-xs text-st-muted">Official missions already have a system owner and are skipped.</p>
                </div>
                <div className="flex gap-2">
                  <select
                    value={bulkOwnerUserId}
                    onChange={(event) => setBulkOwnerUserId(event.target.value as Id<"users"> | "")}
                    className="min-w-0 flex-1 rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-fg outline-none focus:border-st-accent"
                  >
                    <option value="">System / unowned</option>
                    {ownerOptions.map((owner) => (
                      <option key={owner._id} value={owner._id}>
                        {ownerOptionLabel(owner)}
                      </option>
                    ))}
                  </select>
                  <Button type="button" onClick={() => void handleBulkOwnerUpdate()} disabled={bulkOwnerBusy}>
                    {bulkOwnerBusy ? "Applying…" : "Apply"}
                  </Button>
                </div>
                {bulkOwnerResult !== null && <p className="text-xs text-emerald-300">{bulkOwnerResult}</p>}
                {bulkOwnerError !== null && <p className="text-xs text-red-300">{bulkOwnerError}</p>}
              </div>

              {/* Source */}
              <div className="space-y-1.5">
                <div>
                  <p className="text-xs font-semibold text-st-fg">Source</p>
                  <p className="text-xs text-st-muted">Switching to official automatically clears any community owner.</p>
                </div>
                <div className="flex gap-2">
                  <select
                    value={bulkSource}
                    onChange={(event) => setBulkSource(event.target.value as MissionRow["source"])}
                    className="min-w-0 flex-1 rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-fg outline-none focus:border-st-accent"
                  >
                    <option value="community">Community</option>
                    <option value="official">Official</option>
                  </select>
                  <Button type="button" onClick={() => void handleBulkSourceUpdate()} disabled={bulkSourceBusy}>
                    {bulkSourceBusy ? "Applying…" : "Apply"}
                  </Button>
                </div>
                {bulkSourceResult !== null && <p className="text-xs text-emerald-300">{bulkSourceResult}</p>}
                {bulkSourceError !== null && <p className="text-xs text-red-300">{bulkSourceError}</p>}
              </div>
            </div>

            {/* Moderation note */}
            <div className="space-y-1.5">
              <p className="text-xs font-semibold text-st-fg">Moderation note <span className="font-normal text-st-muted">(optional — logged with every action above)</span></p>
              <ModerationNotePresets
                onSelect={(preset) => setBulkModerationNote((current) => applyModerationNotePreset(current, preset))}
              />
              <textarea
                value={bulkModerationNote}
                onChange={(event) => setBulkModerationNote(event.target.value)}
                rows={2}
                placeholder="Why is this batch change being made?"
                className="w-full rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-fg outline-none focus:border-st-accent"
              />
            </div>
          </div>
        )}
      </Card>

      <div className="space-y-4">
          {filteredMissions.length === 0 ? (
            <Card className="text-sm text-st-muted">
              No missions match the current filters.
            </Card>
          ) : (
            filteredMissions
              .slice()
              .sort((left, right) => left.sortOrder - right.sortOrder || left.name.localeCompare(right.name))
              .map((mission) => (
                <MissionCard
                  key={mission.key}
                  mission={mission}
                  selected={selectedKeySet.has(mission.key)}
                  onToggleSelect={toggleSelectedKey}
                />
              ))
          )}
      </div>
    </div>
  );
}
