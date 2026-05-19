import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { Link, useParams } from "react-router-dom";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { MapCatalogRow } from "../../../convex/sim/mapCatalog";
import {
  type AssignableOwnerRow,
  type EmpireNpcRow,
  type MissionRow,
  type StrategyOption,
  MissionScenarioEditor,
  ModerationNotePresets,
  applyModerationNotePreset,
  formatCsv,
  formatTimestamp,
  mutationErrorMessage,
  ownerOptionLabel,
  parseCsv,
  reviewTone,
  statusTone,
} from "./adminMissionsShared";

export function AdminMissionEditPage() {
  const { missionKey } = useParams<{ missionKey: string }>();

  const missionsQuery = useQuery(api.admin.queries.listMissions, {
    publishedOnly: false,
    fallbackToBuiltIns: false,
  });
  const usersQuery = useQuery(api.admin.queries.listUsers, { limit: 256 });
  const mapsQuery = useQuery(api.admin.queries.listMaps, {});
  const strategiesQuery = useQuery(api.admin.queries.listAutomationStrategies, {});
  const npcQuery = useQuery(api.admin.queries.listEmpireNpcPlayers, {
    includeInactive: false,
    fallbackToBuiltIns: false,
  });
  const updateMission = useMutation(api.admin.mutations.updateMission);

  const strategies = useMemo(
    () =>
      strategiesQuery?.authorized
        ? ((strategiesQuery.strategies as StrategyOption[]).filter((s) => s.availableForNpcs))
        : [],
    [strategiesQuery],
  );
  const empireNpcs = useMemo(
    () => (npcQuery?.authorized ? (npcQuery.empireNpcs as EmpireNpcRow[]) : []),
    [npcQuery],
  );
  const ownerOptions = useMemo(
    () =>
      usersQuery?.authorized
        ? (usersQuery.users as AssignableOwnerRow[])
            .filter((user) => user.admin || user.publisher)
            .sort((left, right) => ownerOptionLabel(left).localeCompare(ownerOptionLabel(right)))
        : [],
    [usersQuery],
  );
  const mapOptions = useMemo(
    () => (mapsQuery?.authorized ? (mapsQuery.maps as MapCatalogRow[]) : []),
    [mapsQuery],
  );

  const missions = useMemo(
    () => (missionsQuery?.authorized ? (missionsQuery.missions as MissionRow[]) : []),
    [missionsQuery],
  );
  const mission = useMemo(
    () => missions.find((m) => m.key === missionKey) ?? null,
    [missions, missionKey],
  );

  if (
    missionsQuery === undefined ||
    usersQuery === undefined ||
    mapsQuery === undefined ||
    strategiesQuery === undefined ||
    npcQuery === undefined
  ) {
    return (
      <div className="mx-auto max-w-[86.4rem] px-4 py-6">
        <Card className="text-sm text-st-muted">Loading...</Card>
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

  if (mission === null) {
    return (
      <div className="mx-auto max-w-[86.4rem] px-4 py-6">
        <Card className="space-y-3">
          <p className="text-sm text-st-muted">
            Mission <span className="font-mono text-st-fg">{missionKey}</span> not found.
          </p>
          <Link
            to="/admin/mission"
            className="inline-flex rounded border border-st-border px-3 py-1.5 text-xs text-st-muted hover:border-st-accent/40 hover:text-st-fg"
          >
            ← Back to missions
          </Link>
        </Card>
      </div>
    );
  }

  return (
    <MissionEditForm
      mission={mission}
      empireNpcs={empireNpcs}
      strategies={strategies}
      ownerOptions={ownerOptions}
      mapOptions={mapOptions}
      onSave={async (args) => {
        await updateMission(args);
      }}
    />
  );
}

function MissionEditForm(props: {
  mission: MissionRow;
  empireNpcs: EmpireNpcRow[];
  strategies: StrategyOption[];
  ownerOptions: AssignableOwnerRow[];
  mapOptions: MapCatalogRow[];
  onSave: (args: {
    key: string;
    name: string;
    description: string;
    mapKey: string;
    ownerUserId: Id<"users"> | null;
    source: MissionRow["source"];
    reviewStatus: MissionRow["reviewStatus"];
    status: MissionRow["status"];
    mode: MissionRow["mode"];
    requiredTier: MissionRow["requiredTier"];
    level: number;
    requiredWins: number;
    prerequisiteMissionKeys: string[];
    published: boolean;
    sortOrder: number;
    retentionClass: MissionRow["retentionClass"];
    scenarioJson: string;
    moderationNote: string;
  }) => Promise<void>;
}) {
  const [name, setName] = useState(props.mission.name);
  const [description, setDescription] = useState(props.mission.description);
  const [mapKey, setMapKey] = useState(props.mission.mapKey);
  const [ownerUserId, setOwnerUserId] = useState<Id<"users"> | "">(props.mission.ownerUserId ?? "");
  const [source, setSource] = useState<MissionRow["source"]>(props.mission.source);
  const [reviewStatus, setReviewStatus] = useState<MissionRow["reviewStatus"]>(props.mission.reviewStatus);
  const [contentStatus, setContentStatus] = useState<MissionRow["status"]>(props.mission.status);
  const [mode, setMode] = useState<MissionRow["mode"]>(props.mission.mode);
  const [requiredTier, setRequiredTier] = useState<MissionRow["requiredTier"]>(props.mission.requiredTier);
  const [level, setLevel] = useState(String(props.mission.level));
  const [requiredWins, setRequiredWins] = useState(String(props.mission.requiredWins));
  const [prerequisitesText, setPrerequisitesText] = useState(
    formatCsv(props.mission.prerequisiteMissionKeys),
  );
  const [sortOrder, setSortOrder] = useState(String(props.mission.sortOrder));
  const [retentionClass, setRetentionClass] = useState<MissionRow["retentionClass"]>(
    props.mission.retentionClass,
  );
  const [scenarioJson, setScenarioJson] = useState(props.mission.scenarioJson);
  const [moderationNote, setModerationNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [saveStatus, setSaveStatus] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const mapOptions = props.mapOptions;

  useEffect(() => {
    if (mapOptions.length === 0) {
      return;
    }
    if (mapOptions.some((map) => map.key === mapKey)) {
      return;
    }
    setMapKey(mapOptions[0]!.key);
  }, [mapKey, mapOptions]);

  const readOnly =
    props.mission.status === "archived" ||
    props.mission.status === "deleted" ||
    props.mission.status === "admin_deleted";

  async function handleSave() {
    setBusy(true);
    setSaveStatus(null);
    setSaveError(null);
    try {
      await props.onSave({
        key: props.mission.key,
        name,
        description,
        mapKey,
        ownerUserId: source === "community" ? ownerUserId || null : null,
        source,
        reviewStatus: source === "official" ? "approved" : reviewStatus,
        status: contentStatus,
        mode,
        requiredTier,
        level: Number(level),
        requiredWins: Number(requiredWins),
        prerequisiteMissionKeys: parseCsv(prerequisitesText),
        published: contentStatus === "published",
        sortOrder: Number(sortOrder),
        retentionClass,
        scenarioJson,
        moderationNote,
      });
      setModerationNote("");
      setSaveStatus("Saved.");
    } catch (err) {
      setSaveError(mutationErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-[86.4rem] space-y-6 px-4 py-6">
      <Card className="space-y-4">
        {/* Page header */}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-st-muted">Admin · Missions</p>
            <h1 className="text-2xl font-semibold text-st-fg">{props.mission.name}</h1>
            <div className="mt-2 flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <span className="font-mono text-sm text-st-muted">{props.mission.key}</span>
              <span className="text-xs text-st-muted">·</span>
              <span className="text-xs text-st-muted">Lv {props.mission.level}</span>
              <span className="text-xs text-st-muted">·</span>
              <span className="text-xs text-st-muted">{props.mission.mapKey}</span>
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
          </div>
          <Link
            to="/admin/mission"
            className="shrink-0 self-start rounded border border-st-border px-3 py-1.5 text-xs text-st-muted hover:border-st-accent/40 hover:text-st-fg"
          >
            ← Back to missions
          </Link>
        </div>

        <div className="space-y-4">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <label className="grid gap-1 text-xs text-st-muted">
              <span>Name</span>
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                className="rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-fg outline-none focus:border-st-accent"
              />
            </label>
            <label className="grid gap-1 text-xs text-st-muted">
              <span>Map</span>
              <select
                value={mapKey}
                onChange={(event) => setMapKey(event.target.value)}
                disabled={mapOptions.length === 0}
                className="rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-fg outline-none focus:border-st-accent disabled:opacity-60"
              >
                {mapOptions.length === 0 ? <option value="">No maps available</option> : null}
                {!mapOptions.some((map) => map.key === mapKey) ? (
                  <option value={mapKey}>{mapKey}</option>
                ) : null}
                {mapOptions.map((map) => (
                  <option key={map.key} value={map.key}>
                    {map.name} ({map.key})
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 text-xs text-st-muted">
              <span>Level</span>
              <input
                type="number"
                min={1}
                step={1}
                value={level}
                onChange={(event) => setLevel(event.target.value)}
                className="rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-fg outline-none focus:border-st-accent"
              />
            </label>
            <label className="grid gap-1 text-xs text-st-muted">
              <span>Wins required</span>
              <input
                type="number"
                min={1}
                step={1}
                value={requiredWins}
                onChange={(event) => setRequiredWins(event.target.value)}
                className="rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-fg outline-none focus:border-st-accent"
              />
            </label>
            <label className="grid gap-1 text-xs text-st-muted">
              <span>Mode</span>
              <select
                value={mode}
                onChange={(event) => setMode(event.target.value as MissionRow["mode"])}
                className="rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-fg outline-none focus:border-st-accent"
              >
                <option value="conquest_core">conquest_core</option>
                <option value="conquest_plus">conquest_plus</option>
                <option value="trader_economy">trader_economy</option>
              </select>
            </label>
          </div>

          <label className="grid gap-1 text-xs text-st-muted">
            <span>Description</span>
            <input
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              className="rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-fg outline-none focus:border-st-accent"
            />
          </label>

          <div className="grid gap-3 md:grid-cols-4">
            <label className="grid gap-1 text-xs text-st-muted">
              <span>Source</span>
              <select
                value={source}
                disabled={readOnly}
                onChange={(event) => {
                  const nextSource = event.target.value as MissionRow["source"];
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
                onChange={(event) => setReviewStatus(event.target.value as MissionRow["reviewStatus"])}
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
                onChange={(event) => setContentStatus(event.target.value as MissionRow["status"])}
                className="rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-fg outline-none focus:border-st-accept"
              >
                <option value="draft">draft</option>
                <option value="published">published</option>
                <option value="archived">archived</option>
                <option value="deleted">deleted</option>
                <option value="admin_deleted">admin_deleted</option>
              </select>
            </label>
          </div>

          <div className="grid gap-3 md:grid-cols-[2fr,140px,180px,160px]">
            <label className="grid gap-1 text-xs text-st-muted">
              <span>Prerequisite mission keys</span>
              <input
                value={prerequisitesText}
                onChange={(event) => setPrerequisitesText(event.target.value)}
                placeholder="starter-small-1, mission-2"
                className="rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-fg outline-none focus:border-st-accent"
              />
            </label>
            <label className="grid gap-1 text-xs text-st-muted">
              <span>Sort order</span>
              <input
                type="number"
                min={0}
                step={1}
                value={sortOrder}
                onChange={(event) => setSortOrder(event.target.value)}
                className="rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-fg outline-none focus:border-st-accent"
              />
            </label>
            <label className="grid gap-1 text-xs text-st-muted">
              <span>Retention class</span>
              <select
                value={retentionClass}
                onChange={(event) => setRetentionClass(event.target.value as MissionRow["retentionClass"])}
                className="rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-fg outline-none focus:border-st-accent"
              >
                <option value="official">official</option>
                <option value="archived_debug">archived_debug</option>
                <option value="discarded">discarded</option>
              </select>
            </label>
            <label className="grid gap-1 text-xs text-st-muted">
              <span>Required tier</span>
              <select
                value={requiredTier}
                onChange={(event) => setRequiredTier(event.target.value as MissionRow["requiredTier"])}
                className="rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-fg outline-none focus:border-st-accent"
              >
                <option value="free">free</option>
                <option value="pro">pro</option>
              </select>
            </label>
          </div>

          <p className="rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-muted">
            Player availability:{" "}
            <span className="font-medium text-st-fg">
              {contentStatus === "published" ? "Published" : "Not published"}
            </span>
          </p>

          <div className="grid gap-1">
            <span className="text-xs text-st-muted font-medium">Scenario Builder</span>
            <MissionScenarioEditor
              scenarioJson={scenarioJson}
              onScenarioJsonChange={setScenarioJson}
              empireNpcs={props.empireNpcs}
              strategies={props.strategies}
            />
          </div>

          <label className="grid gap-1 text-xs text-st-muted">
            <span>Scenario JSON</span>
            <textarea
              value={scenarioJson}
              onChange={(event) => setScenarioJson(event.target.value)}
              rows={16}
              spellCheck={false}
              className="rounded border border-st-border bg-slate-950/60 px-3 py-2 font-mono text-xs text-st-fg outline-none focus:border-st-accent"
            />
          </label>

          <label className="grid gap-1 text-xs text-st-muted">
            <span>Moderation note (optional)</span>
            <ModerationNotePresets
              disabled={readOnly}
              onSelect={(preset) => setModerationNote((current) => applyModerationNotePreset(current, preset))}
            />
            <textarea
              value={moderationNote}
              disabled={readOnly}
              onChange={(event) => setModerationNote(event.target.value)}
              rows={3}
              placeholder="Why is this admin change being made?"
              className="rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-fg outline-none focus:border-st-accent"
            />
          </label>

          {/* Moderation history */}
          {props.mission.moderationHistory.length > 0 && (
            <div className="space-y-1 rounded border border-st-border bg-st-bg/40 px-3 py-3 text-xs text-st-muted">
              <p className="font-medium text-st-fg">Moderation history</p>
              {props.mission.moderationHistory.map((event, index) => (
                <div key={`${event.createdAt}-${index}`}>
                  <p>
                    {formatTimestamp(event.createdAt)} · {event.actorLabel ?? "Unknown admin"} · {event.summary}
                  </p>
                  {event.note !== null ? <p className="text-st-fg">Note: {event.note}</p> : null}
                </div>
              ))}
            </div>
          )}

          {saveStatus !== null ? <p className="text-sm text-emerald-300">{saveStatus}</p> : null}
          {saveError !== null ? <p className="text-sm text-red-300">{saveError}</p> : null}
          {readOnly ? (
            <p className="text-sm text-st-muted">
              This mission is in a terminal state and cannot be edited.
            </p>
          ) : null}

          <div className="flex justify-end gap-2 pb-2">
            <Link
              to="/admin/mission"
              className="inline-flex items-center rounded border border-st-border bg-transparent px-3 py-2 text-sm text-st-fg hover:bg-st-border"
            >
              Back to missions
            </Link>
            <Button type="button" onClick={() => void handleSave()} disabled={busy || readOnly}>
              {busy ? "Saving…" : "Save mission"}
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
