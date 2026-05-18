import { FormEvent, useDeferredValue, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { useSearchParams } from "react-router-dom";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

type StrategyPreview = {
  stance: string;
  earlyRush: boolean;
  reserveShipsPct: number;
  reinforceAttackedSystems: boolean;
} | null;

type StrategyCatalogRow = {
  key: string;
  name: string;
  description: string;
  tags: string[];
  strategyJson: string;
  preview: StrategyPreview;
  ownerUserId: Id<"users"> | null;
  ownerLabel: string | null;
  source: "official" | "community";
  reviewStatus: "unreviewed" | "needs_changes" | "approved";
  status: "draft" | "published" | "archived" | "deleted" | "admin_deleted";
  availableForHumans: boolean;
  availableForNpcs: boolean;
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

function statusTone(status: StrategyCatalogRow["status"]): string {
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

function reviewTone(reviewStatus: StrategyCatalogRow["reviewStatus"]): string {
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

function formatTimestamp(value: number): string {
  return new Date(value).toLocaleString();
}

function parseTags(text: string): string[] {
  return text
    .split(/[\n,]/)
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0);
}

function formatTags(tags: string[]): string {
  return tags.join(", ");
}

function normalizeSearchText(value: string): string {
  return value.trim().toLowerCase();
}

function readStrategySourceFilter(value: string | null): "all" | StrategyCatalogRow["source"] {
  return value === "official" || value === "community" ? value : "all";
}

function readStrategyStatusFilter(value: string | null): "all" | StrategyCatalogRow["status"] {
  return value === "draft" ||
    value === "published" ||
    value === "archived" ||
    value === "deleted" ||
    value === "admin_deleted"
    ? value
    : "all";
}

function readStrategyOwnerFilter(value: string | null): "all" | "system" | Id<"users"> {
  if (value === "all" || value === null || value.trim().length === 0) {
    return "all";
  }
  if (value === "system") {
    return "system";
  }
  return value as Id<"users">;
}

function readStrategyReviewFilter(value: string | null): "all" | StrategyCatalogRow["reviewStatus"] {
  return value === "unreviewed" || value === "needs_changes" || value === "approved"
    ? value
    : "all";
}

function StrategyCard(props: {
  strategy: StrategyCatalogRow;
  selected: boolean;
  onToggleSelect: (key: string) => void;
  ownerOptions: AssignableOwnerRow[];
  onSave: (args: {
    key: string;
    name: string;
    description: string;
    tags: string[];
    strategyJson: string;
    ownerUserId: Id<"users"> | null;
    source: StrategyCatalogRow["source"];
    reviewStatus: StrategyCatalogRow["reviewStatus"];
    status: StrategyCatalogRow["status"];
    moderationNote: string;
    availableForHumans: boolean;
    availableForNpcs: boolean;
  }) => Promise<void>;
}) {
  const [name, setName] = useState(props.strategy.name);
  const [description, setDescription] = useState(props.strategy.description);
  const [tagsText, setTagsText] = useState(formatTags(props.strategy.tags));
  const [strategyJson, setStrategyJson] = useState(props.strategy.strategyJson);
  const [ownerUserId, setOwnerUserId] = useState<Id<"users"> | "">(props.strategy.ownerUserId ?? "");
  const [source, setSource] = useState<StrategyCatalogRow["source"]>(props.strategy.source);
  const [reviewStatus, setReviewStatus] = useState<StrategyCatalogRow["reviewStatus"]>(props.strategy.reviewStatus);
  const [contentStatus, setContentStatus] = useState<StrategyCatalogRow["status"]>(props.strategy.status);
  const [availableForHumans, setAvailableForHumans] = useState(props.strategy.availableForHumans);
  const [availableForNpcs, setAvailableForNpcs] = useState(props.strategy.availableForNpcs);
  const [moderationNote, setModerationNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const readOnly =
    props.strategy.status === "archived" ||
    props.strategy.status === "deleted" ||
    props.strategy.status === "admin_deleted";

  async function handleSave() {
    setBusy(true);
    setStatus(null);
    setError(null);
    try {
      await props.onSave({
        key: props.strategy.key,
        name,
        description,
        tags: parseTags(tagsText),
        strategyJson,
        ownerUserId: source === "community" ? ownerUserId || null : null,
        source,
        reviewStatus: source === "official" ? "approved" : reviewStatus,
        status: contentStatus,
        moderationNote,
        availableForHumans,
        availableForNpcs,
      });
      setModerationNote("");
      setStatus("Saved.");
    } catch (saveError) {
      setError(mutationErrorMessage(saveError));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <input
            type="checkbox"
            checked={props.selected}
            onChange={() => props.onToggleSelect(props.strategy.key)}
            className="mt-1 accent-cyan-400"
            aria-label={`Select ${props.strategy.key}`}
          />
          <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-st-fg">{props.strategy.name}</h3>
            <span className="rounded border border-st-border px-2 py-0.5 text-xs text-st-muted">
              {props.strategy.key}
            </span>
          </div>
          <p className="mt-1 text-sm text-st-muted">
            Preview: {props.strategy.preview === null ? "No preview available" : `${props.strategy.preview.stance} · ${props.strategy.preview.reserveShipsPct}% reserve`}
          </p>
          <p className="mt-1 text-xs text-st-muted">
            Owner {props.strategy.ownerLabel ?? props.strategy.ownerUserId ?? "System"}
          </p>
          <p className="mt-1 text-xs text-st-muted">
            Updated {formatTimestamp(props.strategy.updatedAt)} · Created {formatTimestamp(props.strategy.createdAt)}
          </p>
          {props.strategy.moderationHistory.length > 0 ? (
            <div className="mt-2 space-y-1 text-xs text-st-muted">
              <p className="font-medium text-st-fg">Recent moderation</p>
              {props.strategy.moderationHistory.map((event, index) => (
                <div key={`${event.createdAt}-${index}`}>
                  <p>
                    {formatTimestamp(event.createdAt)} · {event.actorLabel ?? "Unknown admin"} · {event.summary}
                  </p>
                  {event.note !== null ? <p className="text-st-fg">Note: {event.note}</p> : null}
                </div>
              ))}
            </div>
          ) : null}
        </div>
        </div>
        <div className="flex flex-wrap gap-2 text-xs text-st-muted">
          <span className={`rounded border px-2 py-0.5 ${props.strategy.source === "community" ? "border-sky-500/40 bg-sky-950/30 text-sky-200" : "border-st-border"}`}>
            {props.strategy.source}
          </span>
          <span className={`rounded border px-2 py-0.5 ${reviewTone(props.strategy.reviewStatus)}`}>
            review {props.strategy.reviewStatus}
          </span>
          <span className={`rounded border px-2 py-0.5 ${statusTone(props.strategy.status)}`}>
            {props.strategy.status}
          </span>
          <span className="rounded border border-st-border px-2 py-0.5">
            Humans {availableForHumans ? "on" : "off"}
          </span>
          <span className="rounded border border-st-border px-2 py-0.5">
            NPCs {availableForNpcs ? "on" : "off"}
          </span>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <label className="grid gap-1 text-xs text-st-muted">
          <span>Name</span>
          <input
            value={name}
            disabled={readOnly}
            onChange={(event) => setName(event.target.value)}
            className="rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-fg outline-none focus:border-st-accent"
          />
        </label>
        <label className="grid gap-1 text-xs text-st-muted">
          <span>Description</span>
          <input
            value={description}
            disabled={readOnly}
            onChange={(event) => setDescription(event.target.value)}
            className="rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-fg outline-none focus:border-st-accent"
          />
        </label>
      </div>

      <label className="grid gap-1 text-xs text-st-muted">
        <span>Tags</span>
        <input
          value={tagsText}
          disabled={readOnly}
          onChange={(event) => setTagsText(event.target.value)}
          placeholder="balanced, expansion, starter"
          className="rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-fg outline-none focus:border-st-accent"
        />
      </label>

      <label className="grid gap-1 text-xs text-st-muted">
        <span>Raw Strategy JSON</span>
        <textarea
          value={strategyJson}
          disabled={readOnly}
          onChange={(event) => setStrategyJson(event.target.value)}
          rows={12}
          spellCheck={false}
          className="rounded border border-st-border bg-slate-950/60 px-3 py-2 font-mono text-xs text-st-fg outline-none focus:border-st-accent"
        />
      </label>

      <div className="grid gap-3 md:grid-cols-4">
        <label className="grid gap-1 text-xs text-st-muted">
          <span>Source</span>
          <select
            value={source}
            disabled={readOnly}
            onChange={(event) => {
              const nextSource = event.target.value as StrategyCatalogRow["source"];
              setSource(nextSource);
              if (nextSource === "official") {
                setReviewStatus("approved");
              }
            }}
            className="rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-fg outline-none focus:border-st-accent"
          >
            <option value="official">official</option>
            <option value="community">community</option>
          </select>
        </label>
        <label className="grid gap-1 text-xs text-st-muted">
          <span>Owner</span>
          <select
            value={source === "community" ? ownerUserId : ""}
            disabled={readOnly || source !== "community"}
            onChange={(event) => setOwnerUserId(event.target.value as Id<"users"> | "")}
            className="rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-fg outline-none focus:border-st-accent"
          >
            <option value="">System / unowned</option>
            {props.ownerOptions.map((owner) => (
              <option key={owner._id} value={owner._id}>
                {ownerOptionLabel(owner)}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-xs text-st-muted">
          <span>Review</span>
          <select
            value={source === "official" ? "approved" : reviewStatus}
            disabled={readOnly || source === "official"}
            onChange={(event) => setReviewStatus(event.target.value as StrategyCatalogRow["reviewStatus"])}
            className="rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-fg outline-none focus:border-st-accent"
          >
            <option value="unreviewed">unreviewed</option>
            <option value="needs_changes">needs_changes</option>
            <option value="approved">approved</option>
          </select>
        </label>
        <label className="grid gap-1 text-xs text-st-muted">
          <span>Status</span>
          <select
            value={contentStatus}
            disabled={readOnly}
            onChange={(event) => setContentStatus(event.target.value as StrategyCatalogRow["status"])}
            className="rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-fg outline-none focus:border-st-accent"
          >
            <option value="draft">draft</option>
            <option value="published">published</option>
            <option value="archived">archived</option>
            <option value="deleted">deleted</option>
            <option value="admin_deleted">admin_deleted</option>
          </select>
        </label>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <label className="flex items-center gap-2 rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-muted">
          <input
            type="checkbox"
            checked={availableForHumans}
            disabled={readOnly}
            onChange={(event) => setAvailableForHumans(event.target.checked)}
            className="accent-cyan-400"
          />
          Available to human users
        </label>
        <label className="flex items-center gap-2 rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-muted">
          <input
            type="checkbox"
            checked={availableForNpcs}
            disabled={readOnly}
            onChange={(event) => setAvailableForNpcs(event.target.checked)}
            className="accent-cyan-400"
          />
          Available to NPC players
        </label>
      </div>

      <label className="grid gap-1 text-xs text-st-muted">
        <span>Moderation note (optional)</span>
        <textarea
          value={moderationNote}
          disabled={readOnly}
          onChange={(event) => setModerationNote(event.target.value)}
          rows={3}
          placeholder="Why is this admin change being made?"
          className="rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-fg outline-none focus:border-st-accent"
        />
      </label>

      {status !== null ? <p className="text-sm text-emerald-300">{status}</p> : null}
      {error !== null ? <p className="text-sm text-red-300">{error}</p> : null}
      {readOnly ? <p className="text-sm text-st-muted">Terminal content stays visible here but can no longer be edited.</p> : null}

      <div className="flex justify-end">
        <Button type="button" onClick={() => void handleSave()} disabled={busy || readOnly}>
          {busy ? "Saving..." : "Save strategy"}
        </Button>
      </div>
    </Card>
  );
}

function CreateStrategyCard(props: {
  ownerOptions: AssignableOwnerRow[];
  onCreate: (args: {
    key: string;
    name: string;
    description: string;
    tags: string[];
    strategyJson: string;
    ownerUserId: Id<"users"> | null;
    source: StrategyCatalogRow["source"];
    reviewStatus: StrategyCatalogRow["reviewStatus"];
    status: "draft" | "published";
    availableForHumans: boolean;
    availableForNpcs: boolean;
  }) => Promise<void>;
}) {
  const [key, setKey] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [tagsText, setTagsText] = useState("");
  const [strategyJson, setStrategyJson] = useState("{}");
  const [ownerUserId, setOwnerUserId] = useState<Id<"users"> | "">("");
  const [source, setSource] = useState<StrategyCatalogRow["source"]>("official");
  const [reviewStatus, setReviewStatus] = useState<StrategyCatalogRow["reviewStatus"]>("approved");
  const [contentStatus, setContentStatus] = useState<"draft" | "published">("published");
  const [availableForHumans, setAvailableForHumans] = useState(true);
  const [availableForNpcs, setAvailableForNpcs] = useState(true);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setStatus(null);
    setError(null);
    try {
      await props.onCreate({
        key,
        name,
        description,
        tags: parseTags(tagsText),
        strategyJson,
        ownerUserId: source === "community" ? ownerUserId || null : null,
        source,
        reviewStatus: source === "official" ? "approved" : reviewStatus,
        status: contentStatus,
        availableForHumans,
        availableForNpcs,
      });
      setKey("");
      setName("");
      setDescription("");
      setTagsText("");
      setStrategyJson("{}");
      setOwnerUserId("");
      setSource("official");
      setReviewStatus("approved");
      setContentStatus("published");
      setAvailableForHumans(true);
      setAvailableForNpcs(true);
      setStatus("Created strategy.");
    } catch (createError) {
      setError(mutationErrorMessage(createError));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="space-y-4">
      <div>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-st-muted">Create Strategy</h2>
        <p className="mt-1 text-sm text-st-muted">
          Create a new catalog entry. The key is immutable after save, so treat it as the stable slug.
        </p>
      </div>

      <form className="space-y-4" onSubmit={(event) => void handleCreate(event)}>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="grid gap-1 text-xs text-st-muted">
            <span>Key</span>
            <input
              value={key}
              onChange={(event) => setKey(event.target.value)}
              placeholder="balanced-expedition"
              className="rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-fg outline-none focus:border-st-accent"
            />
          </label>
          <label className="grid gap-1 text-xs text-st-muted">
            <span>Name</span>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Balanced Expedition"
              className="rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-fg outline-none focus:border-st-accent"
            />
          </label>
        </div>

        <label className="grid gap-1 text-xs text-st-muted">
          <span>Description</span>
          <input
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Short summary shown in the library"
            className="rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-fg outline-none focus:border-st-accent"
          />
        </label>

        <label className="grid gap-1 text-xs text-st-muted">
          <span>Tags</span>
          <input
            value={tagsText}
            onChange={(event) => setTagsText(event.target.value)}
            placeholder="balanced, expansion, starter"
            className="rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-fg outline-none focus:border-st-accent"
          />
        </label>

        <label className="grid gap-1 text-xs text-st-muted">
          <span>Raw Strategy JSON</span>
          <textarea
            value={strategyJson}
            onChange={(event) => setStrategyJson(event.target.value)}
            rows={12}
            spellCheck={false}
            className="rounded border border-st-border bg-slate-950/60 px-3 py-2 font-mono text-xs text-st-fg outline-none focus:border-st-accent"
          />
        </label>

        <div className="grid gap-3 md:grid-cols-4">
          <label className="grid gap-1 text-xs text-st-muted">
            <span>Source</span>
            <select
              value={source}
              onChange={(event) => {
                const nextSource = event.target.value as StrategyCatalogRow["source"];
                setSource(nextSource);
                if (nextSource === "official") {
                  setReviewStatus("approved");
                }
              }}
              className="rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-fg outline-none focus:border-st-accent"
            >
              <option value="official">official</option>
              <option value="community">community</option>
            </select>
          </label>
          <label className="grid gap-1 text-xs text-st-muted">
            <span>Owner</span>
            <select
              value={source === "community" ? ownerUserId : ""}
              disabled={source !== "community"}
              onChange={(event) => setOwnerUserId(event.target.value as Id<"users"> | "")}
              className="rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-fg outline-none focus:border-st-accent"
            >
              <option value="">System / unowned</option>
              {props.ownerOptions.map((owner) => (
                <option key={owner._id} value={owner._id}>
                  {ownerOptionLabel(owner)}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-xs text-st-muted">
            <span>Review</span>
            <select
              value={source === "official" ? "approved" : reviewStatus}
              disabled={source === "official"}
              onChange={(event) => setReviewStatus(event.target.value as StrategyCatalogRow["reviewStatus"])}
              className="rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-fg outline-none focus:border-st-accent"
            >
              <option value="unreviewed">unreviewed</option>
              <option value="needs_changes">needs_changes</option>
              <option value="approved">approved</option>
            </select>
          </label>
          <label className="grid gap-1 text-xs text-st-muted">
            <span>Status</span>
            <select
              value={contentStatus}
              onChange={(event) => setContentStatus(event.target.value as "draft" | "published")}
              className="rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-fg outline-none focus:border-st-accent"
            >
              <option value="draft">draft</option>
              <option value="published">published</option>
            </select>
          </label>
        </div>

        <div className="grid gap-2 sm:grid-cols-2">
          <label className="flex items-center gap-2 rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-muted">
            <input
              type="checkbox"
              checked={availableForHumans}
              onChange={(event) => setAvailableForHumans(event.target.checked)}
              className="accent-cyan-400"
            />
            Available to human users
          </label>
          <label className="flex items-center gap-2 rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-muted">
            <input
              type="checkbox"
              checked={availableForNpcs}
              onChange={(event) => setAvailableForNpcs(event.target.checked)}
              className="accent-cyan-400"
            />
            Available to NPC players
          </label>
        </div>

        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-st-muted">Raw JSON is validated and normalized on save.</p>
          <Button type="submit" disabled={busy}>
            {busy ? "Creating..." : "Create strategy"}
          </Button>
        </div>

        {status !== null ? <p className="text-sm text-emerald-300">{status}</p> : null}
        {error !== null ? <p className="text-sm text-red-300">{error}</p> : null}
      </form>
    </Card>
  );
}

export function AdminStrategiesPage() {
  const [searchParams] = useSearchParams();
  const strategiesQuery = useQuery(api.admin.queries.listAutomationStrategies, {});
  const usersQuery = useQuery(api.admin.queries.listUsers, { limit: 256 });
  const createAutomationStrategy = useMutation(api.admin.mutations.createAutomationStrategy);
  const updateAutomationStrategy = useMutation(api.admin.mutations.updateAutomationStrategy);
  const bulkUpdateAutomationStrategyStatus = useMutation(api.admin.mutations.bulkUpdateAutomationStrategyStatus);
  const bulkUpdateAutomationStrategyOwner = useMutation(api.admin.mutations.bulkUpdateAutomationStrategyOwner);
  const bulkUpdateAutomationStrategySource = useMutation(api.admin.mutations.bulkUpdateAutomationStrategySource);
  const seedMissingAutomationStrategies = useMutation(api.admin.mutations.seedMissingAutomationStrategies);
  const [searchText, setSearchText] = useState(() => searchParams.get("search") ?? "");
  const [sourceFilter, setSourceFilter] = useState<"all" | StrategyCatalogRow["source"]>(() =>
    readStrategySourceFilter(searchParams.get("source")),
  );
  const [statusFilter, setStatusFilter] = useState<"all" | StrategyCatalogRow["status"]>(() =>
    readStrategyStatusFilter(searchParams.get("status")),
  );
  const [reviewFilter, setReviewFilter] = useState<"all" | StrategyCatalogRow["reviewStatus"]>(() =>
    readStrategyReviewFilter(searchParams.get("review")),
  );
  const [ownerFilter, setOwnerFilter] = useState<"all" | "system" | Id<"users">>(() =>
    readStrategyOwnerFilter(searchParams.get("owner")),
  );
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [bulkStatus, setBulkStatus] = useState<StrategyCatalogRow["status"]>("archived");
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkResult, setBulkResult] = useState<string | null>(null);
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [bulkOwnerUserId, setBulkOwnerUserId] = useState<Id<"users"> | "">("");
  const [bulkOwnerBusy, setBulkOwnerBusy] = useState(false);
  const [bulkOwnerResult, setBulkOwnerResult] = useState<string | null>(null);
  const [bulkOwnerError, setBulkOwnerError] = useState<string | null>(null);
  const [bulkSource, setBulkSource] = useState<StrategyCatalogRow["source"]>("community");
  const [bulkSourceBusy, setBulkSourceBusy] = useState(false);
  const [bulkSourceResult, setBulkSourceResult] = useState<string | null>(null);
  const [bulkSourceError, setBulkSourceError] = useState<string | null>(null);
  const [bulkModerationNote, setBulkModerationNote] = useState("");

  useEffect(() => {
    setSearchText(searchParams.get("search") ?? "");
    setSourceFilter(readStrategySourceFilter(searchParams.get("source")));
    setStatusFilter(readStrategyStatusFilter(searchParams.get("status")));
    setReviewFilter(readStrategyReviewFilter(searchParams.get("review")));
    setOwnerFilter(readStrategyOwnerFilter(searchParams.get("owner")));
  }, [searchParams]);

  const strategies = useMemo(() => strategiesQuery?.strategies ?? [], [strategiesQuery]);
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
  const filteredStrategies = useMemo(
    () =>
      strategies.filter((strategy) => {
        if (sourceFilter !== "all" && strategy.source !== sourceFilter) {
          return false;
        }
        if (statusFilter !== "all" && strategy.status !== statusFilter) {
          return false;
        }
        if (reviewFilter !== "all" && strategy.reviewStatus !== reviewFilter) {
          return false;
        }
        if (ownerFilter === "system" && strategy.ownerUserId !== null) {
          return false;
        }
        if (ownerFilter !== "all" && ownerFilter !== "system" && strategy.ownerUserId !== ownerFilter) {
          return false;
        }
        if (normalizedSearchText.length === 0) {
          return true;
        }
        return [
          strategy.key,
          strategy.name,
          strategy.description,
          strategy.ownerLabel ?? "",
          ...strategy.tags,
        ]
          .join(" ")
          .toLowerCase()
          .includes(normalizedSearchText);
      }),
    [strategies, sourceFilter, statusFilter, reviewFilter, ownerFilter, normalizedSearchText],
  );
  const visibleKeys = useMemo(() => filteredStrategies.map((strategy) => strategy.key), [filteredStrategies]);
  const selectedVisibleCount = useMemo(
    () => visibleKeys.filter((key) => selectedKeySet.has(key)).length,
    [visibleKeys, selectedKeySet],
  );
  const allVisibleSelected = visibleKeys.length > 0 && selectedVisibleCount === visibleKeys.length;

  function clearBulkFeedback() {
    setBulkResult(null);
    setBulkError(null);
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
      setBulkError("Select at least one strategy first.");
      setBulkResult(null);
      return;
    }

    setBulkBusy(true);
    setBulkResult(null);
    setBulkError(null);
    try {
      const result = await bulkUpdateAutomationStrategyStatus({
        keys: selectedKeys,
        status: bulkStatus,
        moderationNote: bulkModerationNote,
      });
      setBulkResult(`Updated ${result.updatedKeys.length} strategies. Skipped ${result.skippedKeys.length}.`);
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
      setBulkOwnerError("Select at least one strategy first.");
      setBulkOwnerResult(null);
      return;
    }

    setBulkOwnerBusy(true);
    setBulkOwnerResult(null);
    setBulkOwnerError(null);
    try {
      const result = await bulkUpdateAutomationStrategyOwner({
        keys: selectedKeys,
        ownerUserId: bulkOwnerUserId || null,
        moderationNote: bulkModerationNote,
      });
      setBulkOwnerResult(`Updated ${result.updatedKeys.length} strategy owners. Skipped ${result.skippedKeys.length}.`);
      setBulkModerationNote("");
      setSelectedKeys([]);
    } catch (error) {
      setBulkOwnerError(mutationErrorMessage(error));
    } finally {
      setBulkOwnerBusy(false);
    }
  }

  async function handleBulkSourceUpdate() {
    clearBulkFeedback();
    if (selectedKeys.length === 0) {
      setBulkSourceError("Select at least one strategy first.");
      setBulkSourceResult(null);
      return;
    }

    setBulkSourceBusy(true);
    setBulkSourceResult(null);
    setBulkSourceError(null);
    try {
      const result = await bulkUpdateAutomationStrategySource({
        keys: selectedKeys,
        source: bulkSource,
        moderationNote: bulkModerationNote,
      });
      setBulkSourceResult(`Updated ${result.updatedKeys.length} strategy sources. Skipped ${result.skippedKeys.length}.`);
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

  return (
    <div className="mx-auto max-w-[86.4rem] space-y-6 px-4 py-6">
      <Card className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-st-muted">Admin</p>
        <h1 className="text-2xl font-semibold text-st-fg">Strategies</h1>
        <p className="text-sm text-st-muted">
          Manage the shared automation strategy catalog that powers the public library and NPC helpers.
        </p>
        <p className="text-sm text-st-muted">
          Keys are stable slugs, while the JSON, labels, tags, and availability flags can be edited in place.
        </p>
      </Card>

      {strategiesQuery?.authorized === false ? (
        <Card className="text-sm text-st-muted">Authentication required.</Card>
      ) : (
        <div className="grid gap-4 xl:grid-cols-[0.95fr,1.05fr]">
          <CreateStrategyCard
            ownerOptions={ownerOptions}
            onCreate={async (args) => {
              await createAutomationStrategy(args);
            }}
          />

          <Card className="space-y-3">
            <div>
              <h2 className="text-sm font-semibold uppercase tracking-wide text-st-muted">Catalog Summary</h2>
              <p className="mt-1 text-sm text-st-muted">
                {strategiesQuery === undefined
                  ? "Loading catalog..."
                  : `${filteredStrategies.length} of ${strategies.length} strategy record${strategies.length === 1 ? "" : "s"} visible with the current filters.`}
              </p>
            </div>

            <div className="grid gap-3 lg:grid-cols-[minmax(0,2fr)_repeat(4,minmax(0,1fr))]">
              <input
                value={searchText}
                onChange={(event) => setSearchText(event.target.value)}
                placeholder="Search key, name, description, owner, or tags"
                className="rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-fg"
              />
              <select
                value={sourceFilter}
                onChange={(event) => setSourceFilter(event.target.value as typeof sourceFilter)}
                className="rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-fg"
              >
                <option value="all">All sources</option>
                <option value="official">Official</option>
                <option value="community">Community</option>
              </select>
              <select
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}
                className="rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-fg"
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
                className="rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-fg"
              >
                <option value="all">All review states</option>
                <option value="unreviewed">Unreviewed</option>
                <option value="needs_changes">Needs changes</option>
                <option value="approved">Approved</option>
              </select>
              <select
                value={ownerFilter}
                onChange={(event) => setOwnerFilter(event.target.value as typeof ownerFilter)}
                className="rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-fg"
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

            <div className="space-y-3 rounded border border-st-border bg-st-bg/70 p-3">
              <div className="grid gap-3 lg:grid-cols-[minmax(0,1.3fr)_auto] lg:items-center">
                <p className="text-sm text-st-muted">
                  {selectedVisibleCount} visible selected · {selectedKeys.length} total selected
                </p>
                <Button type="button" variant="secondary" onClick={toggleSelectVisible} disabled={visibleKeys.length === 0}>
                  {allVisibleSelected ? "Clear visible" : "Select visible"}
                </Button>
              </div>

              <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
                <div className="grid gap-3 lg:grid-cols-[180px_auto]">
                  <select
                    value={bulkStatus}
                    onChange={(event) => setBulkStatus(event.target.value as StrategyCatalogRow["status"])}
                    className="rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-fg"
                  >
                    <option value="draft">Set to draft</option>
                    <option value="published">Set to published</option>
                    <option value="archived">Set to archived</option>
                    <option value="deleted">Set to deleted</option>
                    <option value="admin_deleted">Set to admin_deleted</option>
                  </select>
                  <Button type="button" onClick={() => void handleBulkStatusUpdate()} disabled={bulkBusy || selectedKeys.length === 0}>
                    {bulkBusy ? "Applying..." : "Apply status"}
                  </Button>
                </div>
                <p className="text-xs text-st-muted">Bulk lifecycle action</p>
              </div>

              <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
                <div className="grid gap-3 lg:grid-cols-[minmax(0,260px)_auto]">
                  <select
                    value={bulkOwnerUserId}
                    onChange={(event) => setBulkOwnerUserId(event.target.value as Id<"users"> | "")}
                    className="rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-fg"
                  >
                    <option value="">Set owner to System / unowned</option>
                    {ownerOptions.map((owner) => (
                      <option key={owner._id} value={owner._id}>
                        {ownerOptionLabel(owner)}
                      </option>
                    ))}
                  </select>
                  <Button type="button" onClick={() => void handleBulkOwnerUpdate()} disabled={bulkOwnerBusy || selectedKeys.length === 0}>
                    {bulkOwnerBusy ? "Applying..." : "Apply owner"}
                  </Button>
                </div>
                <p className="text-xs text-st-muted">Official rows skip non-empty owners automatically</p>
              </div>

              <label className="grid gap-1 text-xs text-st-muted">
                <span>Bulk moderation note (optional)</span>
                <textarea
                  value={bulkModerationNote}
                  onChange={(event) => setBulkModerationNote(event.target.value)}
                  rows={2}
                  placeholder="Why is this batch change being made?"
                  className="rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-fg"
                />
              </label>

              <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
                <div className="grid gap-3 lg:grid-cols-[180px_auto]">
                  <select
                    value={bulkSource}
                    onChange={(event) => setBulkSource(event.target.value as StrategyCatalogRow["source"])}
                    className="rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-fg"
                  >
                    <option value="community">Set source to community</option>
                    <option value="official">Set source to official</option>
                  </select>
                  <Button type="button" onClick={() => void handleBulkSourceUpdate()} disabled={bulkSourceBusy || selectedKeys.length === 0}>
                    {bulkSourceBusy ? "Applying..." : "Apply source"}
                  </Button>
                </div>
                <p className="text-xs text-st-muted">Switching to official clears owners automatically</p>
              </div>
            </div>

            {bulkResult !== null ? <p className="text-sm text-emerald-300">{bulkResult}</p> : null}
            {bulkError !== null ? <p className="text-sm text-red-300">{bulkError}</p> : null}
            {bulkOwnerResult !== null ? <p className="text-sm text-emerald-300">{bulkOwnerResult}</p> : null}
            {bulkOwnerError !== null ? <p className="text-sm text-red-300">{bulkOwnerError}</p> : null}
            {bulkSourceResult !== null ? <p className="text-sm text-emerald-300">{bulkSourceResult}</p> : null}
            {bulkSourceError !== null ? <p className="text-sm text-red-300">{bulkSourceError}</p> : null}

            <div className="grid gap-2 sm:grid-cols-2">
              <div className="rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-muted">
                Human-visible: <span className="font-medium text-st-fg">{strategies.filter((strategy) => strategy.availableForHumans).length}</span>
              </div>
              <div className="rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-muted">
                NPC-visible: <span className="font-medium text-st-fg">{strategies.filter((strategy) => strategy.availableForNpcs).length}</span>
              </div>
              <div className="rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-muted">
                Official: <span className="font-medium text-st-fg">{strategies.filter((strategy) => strategy.source === "official").length}</span>
              </div>
              <div className="rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-muted">
                Community: <span className="font-medium text-st-fg">{strategies.filter((strategy) => strategy.source === "community").length}</span>
              </div>
            </div>

            <p className="text-xs text-st-muted">
              Built-in strategies are seeded from the source library once and then live in this table.
            </p>

            <div className="flex flex-wrap justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => void seedMissingAutomationStrategies()}
              >
                Seed missing built-ins
              </Button>
            </div>
          </Card>
        </div>
      )}

      {strategiesQuery === undefined ? (
        <Card className="text-sm text-st-muted">Loading strategy catalog...</Card>
      ) : filteredStrategies.length === 0 ? (
        <Card className="text-sm text-st-muted">
          No strategies match the current filters.
        </Card>
      ) : (
        <div className="space-y-4">
          {filteredStrategies.map((strategy) => (
            <StrategyCard
              key={strategy.key}
              strategy={strategy as StrategyCatalogRow}
              selected={selectedKeySet.has(strategy.key)}
              onToggleSelect={toggleSelectedKey}
              ownerOptions={ownerOptions}
              onSave={async (args) => {
                await updateAutomationStrategy(args);
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}