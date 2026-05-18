import { useDeferredValue, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { useNavigate } from "react-router-dom";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useActiveGame } from "@/features/galaxy/hooks/useActiveGame";
import { getGamePath } from "@/features/games/gameRoutes";

type MissionPreview = {
  playerEmpireKey: string;
  npcEmpireCount: number;
  automatedEmpireCount: number;
  delayedAutomationCount: number;
  handicapCount: number;
};

type PublisherMissionRow = {
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
  level: number;
  requiredWins: number;
  prerequisiteMissionKeys: string[];
  published: boolean;
  sortOrder: number;
  retentionClass: "discarded" | "official" | "archived_debug";
  scenarioJson: string;
  preview: MissionPreview;
  createdAt: number;
  updatedAt: number;
};

type PublishedCommunityMissionRow = PublisherMissionRow & {
  game: {
    _id: Id<"sim_games">;
    urlCode: string | null;
    status: "lobby" | "running" | "paused" | "finished";
    startedAt: number | null;
    endedAt: number | null;
  } | null;
  isActiveMember: boolean;
};

type StrategyPreview = {
  stance: string;
  earlyRush: boolean;
  reserveShipsPct: number;
  reinforceAttackedSystems: boolean;
} | null;

type PublisherStrategyRow = {
  key: string;
  name: string;
  description: string;
  tags: string[];
  strategyJson: string;
  source: "official" | "community";
  ownerUserId: Id<"users"> | null;
  ownerLabel: string | null;
  reviewStatus: "unreviewed" | "needs_changes" | "approved";
  status: "draft" | "published" | "archived" | "deleted" | "admin_deleted";
  availableForHumans: boolean;
  availableForNpcs: boolean;
  preview: StrategyPreview;
  createdAt: number;
  updatedAt: number;
};

function mutationErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  return raw.replace(/^[\s\S]*?Error:\s*/g, "").trim() || "Something went wrong.";
}

function formatTimestamp(value: number): string {
  if (value <= 0) {
    return "Built-in";
  }
  return new Date(value).toLocaleString();
}

function parseCsv(text: string): string[] {
  return text
    .split(/[\n,]/)
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

function formatCsv(values: string[]): string {
  return values.join(", ");
}

function normalizeSearchText(value: string): string {
  return value.trim().toLowerCase();
}

function statusTone(status: PublisherMissionRow["status"] | PublisherStrategyRow["status"]): string {
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
      return "border-st-border bg-st-bg text-st-muted";
  }
}

function reviewTone(reviewStatus: PublisherMissionRow["reviewStatus"] | PublisherStrategyRow["reviewStatus"]): string {
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

function formatStrategyPreview(preview: StrategyPreview): string {
  if (preview === null) {
    return "No automation preview available.";
  }
  return [
    `Stance ${preview.stance}`,
    `Reserve ${preview.reserveShipsPct}%`,
    preview.earlyRush ? "Early rush on" : "Early rush off",
    preview.reinforceAttackedSystems ? "Reinforce attacked worlds" : "No auto reinforcement",
  ].join(" · ");
}

function CreatePublisherStrategyCard(props: {
  onCreate: (args: {
    key: string;
    name: string;
    description: string;
    tags: string[];
    strategyJson: string;
    availableForHumans: boolean;
    availableForNpcs: boolean;
    status: "draft" | "published";
  }) => Promise<unknown>;
}) {
  const [key, setKey] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [tagsText, setTagsText] = useState("");
  const [strategyJson, setStrategyJson] = useState("{}\n");
  const [availableForHumans, setAvailableForHumans] = useState(true);
  const [availableForNpcs, setAvailableForNpcs] = useState(false);
  const [status, setStatus] = useState<"draft" | "published">("draft");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      await props.onCreate({
        key,
        name,
        description,
        tags: parseCsv(tagsText),
        strategyJson,
        availableForHumans,
        availableForNpcs,
        status,
      });
      setKey("");
      setName("");
      setDescription("");
      setTagsText("");
      setStrategyJson("{}\n");
      setAvailableForHumans(true);
      setAvailableForNpcs(false);
      setStatus("draft");
      setSuccess("Community strategy created.");
    } catch (createError) {
      setError(mutationErrorMessage(createError));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <h2 className="text-sm font-semibold uppercase tracking-wide text-st-muted">Create Community Strategy</h2>
      <form className="mt-4 grid gap-3" onSubmit={handleSubmit}>
        <div className="grid gap-3 md:grid-cols-2">
          <input value={key} onChange={(event) => setKey(event.target.value)} placeholder="Key" className="rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-fg" />
          <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Name" className="rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-fg" />
        </div>
        <input value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Description" className="rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-fg" />
        <input value={tagsText} onChange={(event) => setTagsText(event.target.value)} placeholder="Tags, comma separated" className="rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-fg" />
        <div className="grid gap-3 md:grid-cols-2">
          <label className="flex items-center gap-2 rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-muted">
            <input type="checkbox" checked={availableForHumans} onChange={(event) => setAvailableForHumans(event.target.checked)} className="accent-cyan-400" />
            Available for humans
          </label>
          <label className="flex items-center gap-2 rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-muted">
            <input type="checkbox" checked={availableForNpcs} onChange={(event) => setAvailableForNpcs(event.target.checked)} className="accent-cyan-400" />
            Available for NPCs
          </label>
        </div>
        <select value={status} onChange={(event) => setStatus(event.target.value as "draft" | "published")} className="rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-fg">
          <option value="draft">Draft</option>
          <option value="published">Published</option>
        </select>
        <textarea value={strategyJson} onChange={(event) => setStrategyJson(event.target.value)} rows={10} className="rounded border border-st-border bg-st-bg px-3 py-2 font-mono text-xs text-st-fg" />
        {error ? <p className="text-sm text-red-300">{error}</p> : null}
        {success ? <p className="text-sm text-emerald-300">{success}</p> : null}
        <div className="flex justify-end">
          <Button type="submit" disabled={busy}>{busy ? "Creating..." : "Create Strategy"}</Button>
        </div>
      </form>
    </Card>
  );
}

function CreatePublisherMissionCard(props: {
  onCreate: (args: {
    key: string;
    name: string;
    description: string;
    mapKey: string;
    mode: "conquest_core" | "conquest_plus" | "trader_economy";
    requiredTier: "free" | "pro";
    level: number;
    requiredWins: number;
    prerequisiteMissionKeys: string[];
    sortOrder: number;
    retentionClass: "discarded" | "official" | "archived_debug";
    scenarioJson: string;
    status: "draft" | "published";
  }) => Promise<unknown>;
}) {
  const [key, setKey] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [mapKey, setMapKey] = useState("v1-twenty");
  const [mode, setMode] = useState<"conquest_core" | "conquest_plus" | "trader_economy">("conquest_core");
  const [requiredTier, setRequiredTier] = useState<"free" | "pro">("free");
  const [level, setLevel] = useState("1");
  const [requiredWins, setRequiredWins] = useState("1");
  const [prerequisiteMissionKeys, setPrerequisiteMissionKeys] = useState("");
  const [sortOrder, setSortOrder] = useState("0");
  const [retentionClass, setRetentionClass] = useState<"discarded" | "official" | "archived_debug">("discarded");
  const [scenarioJson, setScenarioJson] = useState(`{\n  "playerEmpireKey": "aurora",\n  "npcEmpireKeys": [],\n  "automatedEmpireKeys": [],\n  "empireConfigs": []\n}`);
  const [status, setStatus] = useState<"draft" | "published">("draft");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      await props.onCreate({
        key,
        name,
        description,
        mapKey,
        mode,
        requiredTier,
        level: Number(level),
        requiredWins: Number(requiredWins),
        prerequisiteMissionKeys: parseCsv(prerequisiteMissionKeys),
        sortOrder: Number(sortOrder),
        retentionClass,
        scenarioJson,
        status,
      });
      setKey("");
      setName("");
      setDescription("");
      setPrerequisiteMissionKeys("");
      setSuccess("Community mission created.");
    } catch (createError) {
      setError(mutationErrorMessage(createError));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <h2 className="text-sm font-semibold uppercase tracking-wide text-st-muted">Create Community Mission</h2>
      <form className="mt-4 grid gap-3" onSubmit={handleSubmit}>
        <div className="grid gap-3 md:grid-cols-2">
          <input value={key} onChange={(event) => setKey(event.target.value)} placeholder="Key" className="rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-fg" />
          <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Name" className="rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-fg" />
        </div>
        <input value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Description" className="rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-fg" />
        <div className="grid gap-3 md:grid-cols-3">
          <input value={mapKey} onChange={(event) => setMapKey(event.target.value)} placeholder="Map key" className="rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-fg" />
          <select value={mode} onChange={(event) => setMode(event.target.value as typeof mode)} className="rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-fg">
            <option value="conquest_core">conquest_core</option>
            <option value="conquest_plus">conquest_plus</option>
            <option value="trader_economy">trader_economy</option>
          </select>
          <select value={requiredTier} onChange={(event) => setRequiredTier(event.target.value as "free" | "pro")} className="rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-fg">
            <option value="free">Free</option>
            <option value="pro">Pro</option>
          </select>
        </div>
        <div className="grid gap-3 md:grid-cols-4">
          <input value={level} onChange={(event) => setLevel(event.target.value)} placeholder="Level" className="rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-fg" />
          <input value={requiredWins} onChange={(event) => setRequiredWins(event.target.value)} placeholder="Required wins" className="rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-fg" />
          <input value={sortOrder} onChange={(event) => setSortOrder(event.target.value)} placeholder="Sort order" className="rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-fg" />
          <select value={status} onChange={(event) => setStatus(event.target.value as "draft" | "published")} className="rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-fg">
            <option value="draft">Draft</option>
            <option value="published">Published</option>
          </select>
        </div>
        <select value={retentionClass} onChange={(event) => setRetentionClass(event.target.value as typeof retentionClass)} className="rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-fg">
          <option value="discarded">discarded</option>
          <option value="official">official</option>
          <option value="archived_debug">archived_debug</option>
        </select>
        <input value={prerequisiteMissionKeys} onChange={(event) => setPrerequisiteMissionKeys(event.target.value)} placeholder="Prerequisite mission keys, comma separated" className="rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-fg" />
        <textarea value={scenarioJson} onChange={(event) => setScenarioJson(event.target.value)} rows={12} className="rounded border border-st-border bg-st-bg px-3 py-2 font-mono text-xs text-st-fg" />
        {error ? <p className="text-sm text-red-300">{error}</p> : null}
        {success ? <p className="text-sm text-emerald-300">{success}</p> : null}
        <div className="flex justify-end">
          <Button type="submit" disabled={busy}>{busy ? "Creating..." : "Create Mission"}</Button>
        </div>
      </form>
    </Card>
  );
}

function EditableStrategyCard(props: {
  strategy: PublisherStrategyRow;
  onSave: (args: {
    key: string;
    name: string;
    description: string;
    tags: string[];
    strategyJson: string;
    availableForHumans: boolean;
    availableForNpcs: boolean;
    status: PublisherStrategyRow["status"];
  }) => Promise<unknown>;
}) {
  const [name, setName] = useState(props.strategy.name);
  const [description, setDescription] = useState(props.strategy.description);
  const [tagsText, setTagsText] = useState(formatCsv(props.strategy.tags));
  const [strategyJson, setStrategyJson] = useState(props.strategy.strategyJson);
  const [availableForHumans, setAvailableForHumans] = useState(props.strategy.availableForHumans);
  const [availableForNpcs, setAvailableForNpcs] = useState(props.strategy.availableForNpcs);
  const [status, setStatus] = useState<PublisherStrategyRow["status"]>(props.strategy.status);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const readOnly = props.strategy.status === "archived" || props.strategy.status === "deleted" || props.strategy.status === "admin_deleted";

  async function handleSave() {
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      await props.onSave({
        key: props.strategy.key,
        name,
        description,
        tags: parseCsv(tagsText),
        strategyJson,
        availableForHumans,
        availableForNpcs,
        status,
      });
      setSuccess("Saved strategy.");
    } catch (saveError) {
      setError(mutationErrorMessage(saveError));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-st-fg">{props.strategy.name}</h3>
          <p className="mt-1 text-xs text-st-muted">Key {props.strategy.key} · Updated {formatTimestamp(props.strategy.updatedAt)}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <span className="rounded border border-sky-500/40 bg-sky-950/30 px-2 py-1 text-xs text-sky-200">Community</span>
          <span className={`rounded border px-2 py-1 text-xs ${reviewTone(props.strategy.reviewStatus)}`}>
            review {props.strategy.reviewStatus}
          </span>
          <span className={`rounded border px-2 py-1 text-xs ${statusTone(props.strategy.status)}`}>{props.strategy.status}</span>
        </div>
      </div>
      <p className="text-sm text-st-muted">{formatStrategyPreview(props.strategy.preview)}</p>
      <div className="grid gap-3 md:grid-cols-2">
        <input value={name} disabled={readOnly} onChange={(event) => setName(event.target.value)} className="rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-fg" />
        <input value={tagsText} disabled={readOnly} onChange={(event) => setTagsText(event.target.value)} className="rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-fg" />
      </div>
      <input value={description} disabled={readOnly} onChange={(event) => setDescription(event.target.value)} className="w-full rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-fg" />
      <div className="grid gap-3 md:grid-cols-3">
        <label className="flex items-center gap-2 rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-muted"><input type="checkbox" checked={availableForHumans} disabled={readOnly} onChange={(event) => setAvailableForHumans(event.target.checked)} className="accent-cyan-400" />Humans</label>
        <label className="flex items-center gap-2 rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-muted"><input type="checkbox" checked={availableForNpcs} disabled={readOnly} onChange={(event) => setAvailableForNpcs(event.target.checked)} className="accent-cyan-400" />NPCs</label>
        <select value={status} disabled={readOnly} onChange={(event) => setStatus(event.target.value as PublisherStrategyRow["status"])} className="rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-fg">
          <option value="draft">draft</option>
          <option value="published">published</option>
          <option value="archived">archived</option>
          <option value="deleted">deleted</option>
          <option value="admin_deleted">admin_deleted</option>
        </select>
      </div>
      <details>
        <summary className="cursor-pointer text-sm text-st-muted">Strategy JSON</summary>
        <textarea value={strategyJson} disabled={readOnly} onChange={(event) => setStrategyJson(event.target.value)} rows={12} className="mt-3 w-full rounded border border-st-border bg-st-bg px-3 py-2 font-mono text-xs text-st-fg" />
      </details>
      {error ? <p className="text-sm text-red-300">{error}</p> : null}
      {success ? <p className="text-sm text-emerald-300">{success}</p> : null}
      {readOnly ? <p className="text-sm text-st-muted">Terminal content stays visible here but can no longer be edited.</p> : null}
      <div className="flex justify-end">
        <Button type="button" disabled={busy || readOnly} onClick={() => void handleSave()}>{busy ? "Saving..." : "Save Strategy"}</Button>
      </div>
    </Card>
  );
}

function EditableMissionCard(props: {
  mission: PublisherMissionRow;
  onSave: (args: {
    key: string;
    name: string;
    description: string;
    mapKey: string;
    mode: PublisherMissionRow["mode"];
    requiredTier: PublisherMissionRow["requiredTier"];
    level: number;
    requiredWins: number;
    prerequisiteMissionKeys: string[];
    sortOrder: number;
    retentionClass: PublisherMissionRow["retentionClass"];
    scenarioJson: string;
    status: PublisherMissionRow["status"];
  }) => Promise<unknown>;
}) {
  const [name, setName] = useState(props.mission.name);
  const [description, setDescription] = useState(props.mission.description);
  const [mapKey, setMapKey] = useState(props.mission.mapKey);
  const [mode, setMode] = useState<PublisherMissionRow["mode"]>(props.mission.mode);
  const [requiredTier, setRequiredTier] = useState<PublisherMissionRow["requiredTier"]>(props.mission.requiredTier);
  const [level, setLevel] = useState(String(props.mission.level));
  const [requiredWins, setRequiredWins] = useState(String(props.mission.requiredWins));
  const [prerequisiteMissionKeys, setPrerequisiteMissionKeys] = useState(formatCsv(props.mission.prerequisiteMissionKeys));
  const [sortOrder, setSortOrder] = useState(String(props.mission.sortOrder));
  const [retentionClass, setRetentionClass] = useState<PublisherMissionRow["retentionClass"]>(props.mission.retentionClass);
  const [scenarioJson, setScenarioJson] = useState(props.mission.scenarioJson);
  const [status, setStatus] = useState<PublisherMissionRow["status"]>(props.mission.status);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const readOnly = props.mission.status === "archived" || props.mission.status === "deleted" || props.mission.status === "admin_deleted";

  async function handleSave() {
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      await props.onSave({
        key: props.mission.key,
        name,
        description,
        mapKey,
        mode,
        requiredTier,
        level: Number(level),
        requiredWins: Number(requiredWins),
        prerequisiteMissionKeys: parseCsv(prerequisiteMissionKeys),
        sortOrder: Number(sortOrder),
        retentionClass,
        scenarioJson,
        status,
      });
      setSuccess("Saved mission.");
    } catch (saveError) {
      setError(mutationErrorMessage(saveError));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-st-fg">{props.mission.name}</h3>
          <p className="mt-1 text-xs text-st-muted">Key {props.mission.key} · Updated {formatTimestamp(props.mission.updatedAt)}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <span className="rounded border border-sky-500/40 bg-sky-950/30 px-2 py-1 text-xs text-sky-200">Community</span>
          <span className={`rounded border px-2 py-1 text-xs ${reviewTone(props.mission.reviewStatus)}`}>
            review {props.mission.reviewStatus}
          </span>
          <span className={`rounded border px-2 py-1 text-xs ${statusTone(props.mission.status)}`}>{props.mission.status}</span>
        </div>
      </div>
      <p className="text-sm text-st-muted">{props.mission.description}</p>
      <div className="grid gap-3 md:grid-cols-2">
        <input value={name} disabled={readOnly} onChange={(event) => setName(event.target.value)} className="rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-fg" />
        <input value={mapKey} disabled={readOnly} onChange={(event) => setMapKey(event.target.value)} className="rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-fg" />
      </div>
      <input value={description} disabled={readOnly} onChange={(event) => setDescription(event.target.value)} className="w-full rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-fg" />
      <div className="grid gap-3 md:grid-cols-4">
        <select value={mode} disabled={readOnly} onChange={(event) => setMode(event.target.value as PublisherMissionRow["mode"])} className="rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-fg">
          <option value="conquest_core">conquest_core</option>
          <option value="conquest_plus">conquest_plus</option>
          <option value="trader_economy">trader_economy</option>
        </select>
        <select value={requiredTier} disabled={readOnly} onChange={(event) => setRequiredTier(event.target.value as PublisherMissionRow["requiredTier"])} className="rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-fg">
          <option value="free">free</option>
          <option value="pro">pro</option>
        </select>
        <input value={level} disabled={readOnly} onChange={(event) => setLevel(event.target.value)} className="rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-fg" />
        <input value={requiredWins} disabled={readOnly} onChange={(event) => setRequiredWins(event.target.value)} className="rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-fg" />
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        <input value={sortOrder} disabled={readOnly} onChange={(event) => setSortOrder(event.target.value)} className="rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-fg" />
        <select value={retentionClass} disabled={readOnly} onChange={(event) => setRetentionClass(event.target.value as PublisherMissionRow["retentionClass"])} className="rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-fg">
          <option value="discarded">discarded</option>
          <option value="official">official</option>
          <option value="archived_debug">archived_debug</option>
        </select>
        <select value={status} disabled={readOnly} onChange={(event) => setStatus(event.target.value as PublisherMissionRow["status"])} className="rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-fg">
          <option value="draft">draft</option>
          <option value="published">published</option>
          <option value="archived">archived</option>
          <option value="deleted">deleted</option>
          <option value="admin_deleted">admin_deleted</option>
        </select>
      </div>
      <input value={prerequisiteMissionKeys} disabled={readOnly} onChange={(event) => setPrerequisiteMissionKeys(event.target.value)} className="w-full rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-fg" />
      <div className="grid gap-3 md:grid-cols-5 text-xs text-st-muted">
        <div className="rounded border border-st-border bg-st-bg px-3 py-2">Player empire {props.mission.preview.playerEmpireKey}</div>
        <div className="rounded border border-st-border bg-st-bg px-3 py-2">NPCs {props.mission.preview.npcEmpireCount}</div>
        <div className="rounded border border-st-border bg-st-bg px-3 py-2">Automated {props.mission.preview.automatedEmpireCount}</div>
        <div className="rounded border border-st-border bg-st-bg px-3 py-2">Delayed {props.mission.preview.delayedAutomationCount}</div>
        <div className="rounded border border-st-border bg-st-bg px-3 py-2">Handicaps {props.mission.preview.handicapCount}</div>
      </div>
      <details>
        <summary className="cursor-pointer text-sm text-st-muted">Scenario JSON</summary>
        <textarea value={scenarioJson} disabled={readOnly} onChange={(event) => setScenarioJson(event.target.value)} rows={14} className="mt-3 w-full rounded border border-st-border bg-st-bg px-3 py-2 font-mono text-xs text-st-fg" />
      </details>
      {error ? <p className="text-sm text-red-300">{error}</p> : null}
      {success ? <p className="text-sm text-emerald-300">{success}</p> : null}
      {readOnly ? <p className="text-sm text-st-muted">Terminal content stays visible here but can no longer be edited.</p> : null}
      <div className="flex justify-end">
        <Button type="button" disabled={busy || readOnly} onClick={() => void handleSave()}>{busy ? "Saving..." : "Save Mission"}</Button>
      </div>
    </Card>
  );
}

function CommunityStrategyList(props: { strategies: PublisherStrategyRow[] }) {
  return (
    <div className="grid gap-3">
      {props.strategies.map((strategy) => (
        <Card key={strategy.key} className="space-y-2">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="text-base font-semibold text-st-fg">{strategy.name}</h3>
              <p className="mt-1 text-sm text-st-muted">{strategy.description}</p>
            </div>
            <span className="rounded border border-sky-500/40 bg-sky-950/30 px-2 py-1 text-xs text-sky-200">Community</span>
          </div>
          <p className="text-xs text-st-muted">By {strategy.ownerLabel ?? "Unknown publisher"} · {formatStrategyPreview(strategy.preview)}</p>
          <div className="flex flex-wrap gap-2 text-xs text-st-muted">
            {strategy.tags.map((tag) => (
              <span key={tag} className="rounded border border-st-border px-2 py-0.5">{tag}</span>
            ))}
          </div>
        </Card>
      ))}
    </div>
  );
}

export function PublisherPage() {
  const navigate = useNavigate();
  const { selectedGameId, setSelectedGameId } = useActiveGame();
  const dashboard = useQuery(api.publisher.queries.getPublisherDashboard, {});
  const createPublisherMission = useMutation(api.publisher.mutations.createPublisherMission);
  const updatePublisherMission = useMutation(api.publisher.mutations.updatePublisherMission);
  const createPublisherStrategy = useMutation(api.publisher.mutations.createPublisherStrategy);
  const updatePublisherStrategy = useMutation(api.publisher.mutations.updatePublisherStrategy);
  const openPublishedCommunityMissionGame = useMutation(api.publisher.mutations.openPublishedCommunityMissionGame);
  const [communityMissionBusyKey, setCommunityMissionBusyKey] = useState<string | null>(null);
  const [communityMissionError, setCommunityMissionError] = useState<string | null>(null);
  const [missionSearchText, setMissionSearchText] = useState("");
  const [missionModeFilter, setMissionModeFilter] = useState<"all" | "conquest_core" | "conquest_plus" | "trader_economy">("all");
  const [missionTierFilter, setMissionTierFilter] = useState<"all" | "free" | "pro">("all");
  const [missionRunFilter, setMissionRunFilter] = useState<"all" | "ready" | "active" | "replay">("all");
  const [strategySearchText, setStrategySearchText] = useState("");
  const [strategyAvailabilityFilter, setStrategyAvailabilityFilter] = useState<"all" | "humans" | "npcs" | "both">("all");

  if (dashboard === undefined) {
    return (
      <div className="w-full px-4 py-4 sm:px-6">
        <div className="mx-auto max-w-6xl">
          <Card className="text-sm text-st-muted">Loading publisher workspace...</Card>
        </div>
      </div>
    );
  }

  if (!dashboard.authorized) {
    return (
      <div className="w-full px-4 py-4 sm:px-6">
        <div className="mx-auto max-w-6xl">
          <Card className="text-sm text-st-muted">Sign in to browse community publisher content.</Card>
        </div>
      </div>
    );
  }

  const viewer = dashboard.viewer!;
  const publishedCommunityMissions: PublishedCommunityMissionRow[] = dashboard.publishedCommunityMissions.map(
    (mission): PublishedCommunityMissionRow => ({
      ...mission,
      game:
        "game" in mission
          ? mission.game
          : null,
      isActiveMember:
        "isActiveMember" in mission && typeof mission.isActiveMember === "boolean"
          ? mission.isActiveMember
          : false,
    }),
  );
  const publishedCommunityStrategies = dashboard.publishedCommunityStrategies as PublisherStrategyRow[];
  const myMissions = dashboard.myMissions as PublisherMissionRow[];
  const myStrategies = dashboard.myStrategies as PublisherStrategyRow[];
  const deferredMissionSearchText = useDeferredValue(missionSearchText);
  const deferredStrategySearchText = useDeferredValue(strategySearchText);
  const normalizedMissionSearch = normalizeSearchText(deferredMissionSearchText);
  const normalizedStrategySearch = normalizeSearchText(deferredStrategySearchText);
  const filteredPublishedCommunityMissions = publishedCommunityMissions.filter((mission) => {
    if (missionModeFilter !== "all" && mission.mode !== missionModeFilter) {
      return false;
    }
    if (missionTierFilter !== "all" && mission.requiredTier !== missionTierFilter) {
      return false;
    }
    if (missionRunFilter === "ready") {
      if (mission.game !== null) {
        return false;
      }
    } else if (missionRunFilter === "active") {
      if (mission.game === null || !mission.isActiveMember || mission.game.status === "finished") {
        return false;
      }
    } else if (missionRunFilter === "replay") {
      if (mission.game === null) {
        return false;
      }
      if (mission.isActiveMember && mission.game.status !== "finished") {
        return false;
      }
    }

    if (normalizedMissionSearch.length === 0) {
      return true;
    }

    const searchableText = [
      mission.name,
      mission.description,
      mission.ownerLabel ?? "",
      mission.mapKey,
      mission.mode,
      mission.requiredTier,
      mission.preview.playerEmpireKey,
    ]
      .join(" ")
      .toLowerCase();
    return searchableText.includes(normalizedMissionSearch);
  });
  const filteredPublishedCommunityStrategies = publishedCommunityStrategies.filter((strategy) => {
    if (strategyAvailabilityFilter === "humans" && !strategy.availableForHumans) {
      return false;
    }
    if (strategyAvailabilityFilter === "npcs" && !strategy.availableForNpcs) {
      return false;
    }
    if (strategyAvailabilityFilter === "both" && (!strategy.availableForHumans || !strategy.availableForNpcs)) {
      return false;
    }

    if (normalizedStrategySearch.length === 0) {
      return true;
    }

    const searchableText = [
      strategy.name,
      strategy.description,
      strategy.ownerLabel ?? "",
      ...strategy.tags,
      strategy.preview === null ? "" : formatStrategyPreview(strategy.preview),
    ]
      .join(" ")
      .toLowerCase();
    return searchableText.includes(normalizedStrategySearch);
  });

  async function handleOpenCommunityMission(mission: PublishedCommunityMissionRow) {
    const lockedByTier = mission.requiredTier === "pro" && !viewer.admin && viewer.plan !== "pro";
    const lockedByMode = mission.mode === "conquest_plus" && !viewer.admin;
    if (lockedByTier || lockedByMode) {
      return;
    }

    if (mission.game !== null && mission.isActiveMember && mission.game.status !== "finished") {
      setSelectedGameId(mission.game._id);
      void navigate(getGamePath(mission.game));
      return;
    }

    setCommunityMissionBusyKey(mission.key);
    setCommunityMissionError(null);
    try {
      const result = await openPublishedCommunityMissionGame({
        missionKey: mission.key,
        restart: mission.game !== null,
      });
      setSelectedGameId(result.gameId);
      void navigate(getGamePath({ gameId: result.gameId, urlCode: result.urlCode ?? null }));
    } catch (error) {
      setCommunityMissionError(mutationErrorMessage(error));
    } finally {
      setCommunityMissionBusyKey(null);
    }
  }

  function renderCommunityMissionList() {
    return (
      <div className="grid gap-3">
        {filteredPublishedCommunityMissions.map((mission) => {
          const lockedByTier = mission.requiredTier === "pro" && !viewer.admin && viewer.plan !== "pro";
          const lockedByMode = mission.mode === "conquest_plus" && !viewer.admin;
          const busy = communityMissionBusyKey === mission.key;
          const selected = mission.game !== null && selectedGameId === mission.game._id;

          let actionLabel = "Create run";
          if (lockedByMode) {
            actionLabel = "Unpublished mode";
          } else if (lockedByTier) {
            actionLabel = "Pro required";
          } else if (mission.game !== null) {
            if (!mission.isActiveMember || mission.game.status === "finished") {
              actionLabel = "Play again";
            } else if (mission.game.status === "lobby") {
              actionLabel = "Start";
            } else {
              actionLabel = "Continue";
            }
          }

          return (
            <Card key={mission.key} className="space-y-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="text-base font-semibold text-st-fg">{mission.name}</h3>
                  <p className="mt-1 text-sm text-st-muted">{mission.description}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <span className="rounded border border-sky-500/40 bg-sky-950/30 px-2 py-1 text-xs text-sky-200">Community</span>
                  <span className="rounded border border-st-border px-2 py-1 text-xs text-st-muted">{mission.mode}</span>
                  <span className="rounded border border-st-border px-2 py-1 text-xs text-st-muted">Tier {mission.requiredTier}</span>
                  {selected ? <span className="rounded border border-cyan-500/40 bg-cyan-950/30 px-2 py-1 text-xs text-cyan-200">Current run</span> : null}
                </div>
              </div>
              <p className="text-xs text-st-muted">By {mission.ownerLabel ?? "Unknown publisher"} · Map {mission.mapKey} · Player empire {mission.preview.playerEmpireKey}</p>
              <div className="flex flex-wrap gap-2 text-xs text-st-muted">
                <span className="rounded border border-st-border px-2 py-0.5">NPCs {mission.preview.npcEmpireCount}</span>
                <span className="rounded border border-st-border px-2 py-0.5">Automated {mission.preview.automatedEmpireCount}</span>
                <span className="rounded border border-st-border px-2 py-0.5">Delayed {mission.preview.delayedAutomationCount}</span>
                <span className="rounded border border-st-border px-2 py-0.5">Handicaps {mission.preview.handicapCount}</span>
              </div>
              {mission.game !== null ? (
                <p className="text-xs text-st-muted">
                  Current run: {mission.game.status}
                  {mission.isActiveMember ? "" : " · seat inactive"}
                </p>
              ) : (
                <p className="text-xs text-st-muted">No personal run yet.</p>
              )}
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-xs text-st-muted">
                  Community runs stay outside the official progression ladder.
                </p>
                <Button
                  type="button"
                  disabled={busy || lockedByTier || lockedByMode}
                  onClick={() => void handleOpenCommunityMission(mission)}
                >
                  {busy ? "Opening..." : actionLabel}
                </Button>
              </div>
            </Card>
          );
        })}
      </div>
    );
  }

  return (
    <div className="w-full px-4 py-4 sm:px-6">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-4">
        <Card>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="text-sm font-semibold uppercase tracking-wide text-st-muted">Publisher Workspace</h1>
              <p className="mt-2 max-w-4xl text-sm text-st-muted">
                Community publishers can draft, publish, archive, and retire their own strategies and missions here. Published entries remain clearly community content and do not become official catalog content.
              </p>
            </div>
            <div className="flex flex-wrap gap-2 text-xs">
              <span className={`rounded border px-2 py-1 ${dashboard.canPublish ? "border-emerald-500/40 bg-emerald-950/30 text-emerald-200" : "border-st-border bg-st-bg text-st-muted"}`}>
                {dashboard.canPublish ? "Publisher enabled" : "Browse only"}
              </span>
              {viewer.admin ? <span className="rounded border border-amber-500/40 bg-amber-950/30 px-2 py-1 text-amber-200">Admin</span> : null}
            </div>
          </div>
        </Card>

        {dashboard.canPublish ? (
          <div className="grid gap-4 xl:grid-cols-2">
            <CreatePublisherMissionCard onCreate={createPublisherMission} />
            <CreatePublisherStrategyCard onCreate={createPublisherStrategy} />
          </div>
        ) : (
          <Card className="text-sm text-st-muted">
            You can browse published community content here. Ask an admin to grant the Publisher right if you should be able to create or edit community missions and strategies.
          </Card>
        )}

        {communityMissionError ? (
          <Card className="border-red-900/50 bg-red-950/30 text-sm text-red-200">{communityMissionError}</Card>
        ) : null}

        {dashboard.canPublish ? (
          <div className="grid gap-4 xl:grid-cols-2">
            <div className="grid gap-3">
              <Card>
                <h2 className="text-sm font-semibold uppercase tracking-wide text-st-muted">Your Community Missions</h2>
                <p className="mt-2 text-sm text-st-muted">Drafts stay private to you and admins. Archived, deleted, and admin-deleted entries remain visible here as terminal records.</p>
              </Card>
              {myMissions.length === 0 ? <Card className="text-sm text-st-muted">No community missions yet.</Card> : myMissions.map((mission) => <EditableMissionCard key={mission.key} mission={mission} onSave={updatePublisherMission} />)}
            </div>
            <div className="grid gap-3">
              <Card>
                <h2 className="text-sm font-semibold uppercase tracking-wide text-st-muted">Your Community Strategies</h2>
                <p className="mt-2 text-sm text-st-muted">Published strategies appear in the shared strategy library with a community label.</p>
              </Card>
              {myStrategies.length === 0 ? <Card className="text-sm text-st-muted">No community strategies yet.</Card> : myStrategies.map((strategy) => <EditableStrategyCard key={strategy.key} strategy={strategy} onSave={updatePublisherStrategy} />)}
            </div>
          </div>
        ) : null}

        <div className="grid gap-4 xl:grid-cols-2">
          <div className="grid gap-3">
            <Card>
              <h2 className="text-sm font-semibold uppercase tracking-wide text-st-muted">Published Community Missions</h2>
              <p className="mt-2 text-sm text-st-muted">Community scenarios are browseable and launchable here without mixing them into the official starter progression flow.</p>
            </Card>
            {publishedCommunityMissions.length === 0 ? (
              <Card className="text-sm text-st-muted">No published community missions yet.</Card>
            ) : (
              <>
                <Card>
                  <div className="grid gap-3 lg:grid-cols-[minmax(0,2fr)_repeat(3,minmax(0,1fr))]">
                    <input
                      value={missionSearchText}
                      onChange={(event) => setMissionSearchText(event.target.value)}
                      placeholder="Search missions, publishers, maps, or player empire"
                      className="rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-fg"
                    />
                    <select
                      value={missionModeFilter}
                      onChange={(event) => setMissionModeFilter(event.target.value as typeof missionModeFilter)}
                      className="rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-fg"
                    >
                      <option value="all">All modes</option>
                      <option value="conquest_core">Conquest core</option>
                      <option value="conquest_plus">Conquest plus</option>
                      <option value="trader_economy">Trader economy</option>
                    </select>
                    <select
                      value={missionTierFilter}
                      onChange={(event) => setMissionTierFilter(event.target.value as typeof missionTierFilter)}
                      className="rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-fg"
                    >
                      <option value="all">All tiers</option>
                      <option value="free">Free</option>
                      <option value="pro">Pro</option>
                    </select>
                    <select
                      value={missionRunFilter}
                      onChange={(event) => setMissionRunFilter(event.target.value as typeof missionRunFilter)}
                      className="rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-fg"
                    >
                      <option value="all">All run states</option>
                      <option value="ready">No personal run</option>
                      <option value="active">Active run</option>
                      <option value="replay">Replay available</option>
                    </select>
                  </div>
                  <p className="mt-3 text-xs text-st-muted">
                    Showing {filteredPublishedCommunityMissions.length} of {publishedCommunityMissions.length} published community missions.
                  </p>
                </Card>
                {filteredPublishedCommunityMissions.length === 0 ? (
                  <Card className="text-sm text-st-muted">No community missions match the current filters.</Card>
                ) : renderCommunityMissionList()}
              </>
            )}
          </div>
          <div className="grid gap-3">
            <Card>
              <h2 className="text-sm font-semibold uppercase tracking-wide text-st-muted">Published Community Strategies</h2>
              <p className="mt-2 text-sm text-st-muted">These strategies are also available in the shared strategy library and stay labeled as community content.</p>
            </Card>
            {publishedCommunityStrategies.length === 0 ? (
              <Card className="text-sm text-st-muted">No published community strategies yet.</Card>
            ) : (
              <>
                <Card>
                  <div className="grid gap-3 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
                    <input
                      value={strategySearchText}
                      onChange={(event) => setStrategySearchText(event.target.value)}
                      placeholder="Search strategies, publishers, tags, or behavior"
                      className="rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-fg"
                    />
                    <select
                      value={strategyAvailabilityFilter}
                      onChange={(event) => setStrategyAvailabilityFilter(event.target.value as typeof strategyAvailabilityFilter)}
                      className="rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-fg"
                    >
                      <option value="all">All availability</option>
                      <option value="humans">Human-usable</option>
                      <option value="npcs">NPC-usable</option>
                      <option value="both">Humans and NPCs</option>
                    </select>
                  </div>
                  <p className="mt-3 text-xs text-st-muted">
                    Showing {filteredPublishedCommunityStrategies.length} of {publishedCommunityStrategies.length} published community strategies.
                  </p>
                </Card>
                {filteredPublishedCommunityStrategies.length === 0 ? (
                  <Card className="text-sm text-st-muted">No community strategies match the current filters.</Card>
                ) : (
                  <CommunityStrategyList strategies={filteredPublishedCommunityStrategies} />
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}