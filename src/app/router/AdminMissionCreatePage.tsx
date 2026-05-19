import { FormEvent, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { Link, useNavigate } from "react-router-dom";
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
  mutationErrorMessage,
  ownerOptionLabel,
  parseCsv,
} from "./adminMissionsShared";

const DEFAULT_SCENARIO_JSON = JSON.stringify(
  {
    schemaVersion: 2,
    slots: [
      {
        slotKey: "aurora",
        occupant: { kind: "human" },
        automation: { strategyLibraryKey: null, activationTrigger: null },
        presentation: { factionLabelOverride: null, displayNameOverride: null },
        resources: {
          treasuryDelta: 0,
          homeworldPopulationDelta: 0,
          homeworldStockFoodDelta: 0,
          homeworldStockWeaponsDelta: 0,
          homeworldStockResearchDelta: 0,
          homeworldLocalTreasuryDelta: 0,
        },
        sensors: { fightAttraction: null, intruderDetection: null },
        startsHidden: false,
        revealTrigger: null,
      },
    ],
  },
  null,
  2,
);

export function AdminMissionCreatePage() {
  const navigate = useNavigate();
  const usersQuery = useQuery(api.admin.queries.listUsers, { limit: 256 });
  const mapsQuery = useQuery(api.admin.queries.listMaps, {});
  const strategiesQuery = useQuery(api.admin.queries.listAutomationStrategies, {});
  const npcQuery = useQuery(api.admin.queries.listEmpireNpcPlayers, {
    includeInactive: false,
    fallbackToBuiltIns: false,
  });
  const createMission = useMutation(api.admin.mutations.createMission);

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
  const mapOptions = useMemo(
    () => (mapsQuery?.authorized ? (mapsQuery.maps as MapCatalogRow[]) : []),
    [mapsQuery],
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

  const [key, setKey] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [mapKey, setMapKey] = useState("");
  const [ownerUserId, setOwnerUserId] = useState<Id<"users"> | "">("");
  const [source, setSource] = useState<MissionRow["source"]>("official");
  const [reviewStatus, setReviewStatus] = useState<MissionRow["reviewStatus"]>("approved");
  const [contentStatus, setContentStatus] = useState<"draft" | "published">("published");
  const [mode, setMode] = useState<MissionRow["mode"]>("conquest_core");
  const [requiredTier, setRequiredTier] = useState<MissionRow["requiredTier"]>("free");
  const [level, setLevel] = useState("1");
  const [requiredWins, setRequiredWins] = useState("1");
  const [prerequisitesText, setPrerequisitesText] = useState("");
  const [sortOrder, setSortOrder] = useState("100");
  const [retentionClass, setRetentionClass] = useState<MissionRow["retentionClass"]>("official");
  const [scenarioJson, setScenarioJson] = useState(DEFAULT_SCENARIO_JSON);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [aboutOpen, setAboutOpen] = useState(false);

  useEffect(() => {
    if (mapOptions.length === 0) {
      return;
    }
    if (mapOptions.some((map) => map.key === mapKey)) {
      return;
    }
    setMapKey(mapOptions[0]!.key);
  }, [mapKey, mapOptions]);

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setStatus(null);
    setError(null);
    try {
      await createMission({
        key,
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
      });
      void navigate("/admin/mission");
    } catch (createError) {
      setError(mutationErrorMessage(createError));
      setBusy(false);
    }
  }

  if (
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

  if (!usersQuery.authorized) {
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
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-st-muted">Admin · Missions</p>
            <h1 className="text-2xl font-semibold text-st-fg">Create Mission</h1>
            <p className="mt-2 max-w-3xl text-sm text-st-muted">
              Mission keys are stable slugs. Sequence progression with level, prerequisites, and required wins.
            </p>
          </div>
          <Link
            to="/admin/mission"
            className="shrink-0 self-start rounded border border-st-border px-3 py-1.5 text-xs text-st-muted hover:border-st-accent/40 hover:text-st-fg"
          >
            Back to missions
          </Link>
        </div>

        <form className="space-y-4" onSubmit={(event) => void handleCreate(event)}>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <label className="grid gap-1 text-xs text-st-muted">
              <span>Key</span>
              <input
                value={key}
                onChange={(event) => setKey(event.target.value)}
                placeholder="mission-4"
                className="rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-fg outline-none focus:border-st-accent"
              />
            </label>
            <label className="grid gap-1 text-xs text-st-muted">
              <span>Name</span>
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Encirclement"
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
                {mapOptions.length === 0 ? (
                  <option value="">No maps available</option>
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

          <div className="grid gap-3 md:grid-cols-4">
            <label className="grid gap-1 text-xs text-st-muted">
              <span>Source</span>
              <select
                value={source}
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
                disabled={source !== "community"}
                onChange={(event) => setOwnerUserId(event.target.value as Id<"users"> | "")}
                className="rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-fg outline-none focus:border-st-accent"
              >
                <option value="">System / unowned</option>
                {ownerOptions.map((owner) => (
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
                onChange={(event) => setContentStatus(event.target.value as "draft" | "published")}
                className="rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-fg outline-none focus:border-st-accent"
              >
                <option value="draft">draft</option>
                <option value="published">published</option>
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

          <div className="grid gap-3 md:grid-cols-[140px,180px,1fr,180px,160px]">
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
              <span>Prerequisite mission keys</span>
              <input
                value={prerequisitesText}
                onChange={(event) => setPrerequisitesText(event.target.value)}
                placeholder="starter-small-1, mission-2"
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
              empireNpcs={empireNpcs}
              strategies={strategies}
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

          {status !== null ? <p className="text-sm text-emerald-300">{status}</p> : null}
          {error !== null ? <p className="text-sm text-red-300">{error}</p> : null}

          <div className="flex items-center justify-between">
            <Button type="button" variant="secondary" onClick={() => setAboutOpen(true)}>
              About missions
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? "Creating..." : "Create mission"}
            </Button>
          </div>
        </form>
      </Card>

      {aboutOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="About missions"
          onClick={() => setAboutOpen(false)}
        >
          <div
            className="max-h-[80vh] w-full max-w-lg overflow-y-auto rounded-lg border border-st-border bg-st-bg p-6 shadow-xl space-y-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4">
              <h2 className="text-base font-semibold text-st-fg">About missions</h2>
              <button
                type="button"
                className="shrink-0 rounded px-2 py-1 text-xs text-st-muted hover:bg-st-border hover:text-st-fg"
                onClick={() => setAboutOpen(false)}
              >
                Close
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <p className="text-sm font-semibold text-st-fg">Scenario Keys</p>
                <p className="mt-1 text-xs text-st-muted">
                  Use these saved keys inside mission scenario JSON when targeting NPC strategy or NPC empire overrides.
                </p>
              </div>
              <div className="space-y-3 text-xs text-st-muted">
                <div>
                  <p className="font-semibold text-st-fg">NPC strategy keys</p>
                  {strategies.length === 0 ? (
                    <p className="mt-1">No NPC-enabled strategies are available yet.</p>
                  ) : (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {strategies.map((strategy) => (
                        <span key={strategy.key} className="rounded border border-st-border px-2 py-0.5">
                          {strategy.key}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <div>
                  <p className="font-semibold text-st-fg">Empire NPC keys</p>
                  {empireNpcs.length === 0 ? (
                    <p className="mt-1">No empire NPCs are stored yet.</p>
                  ) : (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {empireNpcs.map((npc) => (
                        <span key={npc.key} className="rounded border border-st-border px-2 py-0.5">
                          {npc.key}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="space-y-2 border-t border-st-border pt-4 text-xs text-st-muted">
              <p className="text-sm font-semibold text-st-fg">Scenario Notes</p>
              <p>
                 Mark the player seat by setting exactly one slot occupant to <span className="font-mono text-st-fg">human</span>.
              </p>
              <p>
                Define each seat in <span className="font-mono text-st-fg">slots</span>; each slot keeps its key in{" "}
                <span className="font-mono text-st-fg">slotKey</span> and its occupant in{" "}
                <span className="font-mono text-st-fg">occupant</span>.
              </p>
              <p>
                NPC occupants derive display identity, empire label, color, and default automation from the selected NPC
                profile; human occupants derive those values from the bound player profile and preferences.
              </p>
              <p>
                Hidden NPC slots now have live runtime behavior: <span className="font-mono text-st-fg">revealTrigger</span>{" "}
                controls when they reveal, <span className="font-mono text-st-fg">sensors.intruderDetection</span>{" "}
                lets them react to hostile fleets within the configured route depth, and{" "}
                <span className="font-mono text-st-fg">sensors.fightAttraction</span> makes them reinforce and attack more
                aggressively around detected threats.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
