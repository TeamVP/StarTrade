import { FormEvent, useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

type MissionPreview = {
  playerEmpireKey: string;
  npcEmpireCount: number;
  automatedEmpireCount: number;
  delayedAutomationCount: number;
  handicapCount: number;
};

type MissionRow = {
  key: string;
  name: string;
  description: string;
  mapKey: string;
  mapTier: "small" | "medium" | "large";
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

type StrategyOption = {
  key: string;
  name: string;
  availableForNpcs: boolean;
};

type EmpireNpcRow = {
  key: string;
  playerName: string;
  empireName: string;
  isActive: boolean;
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

function MissionSummary(props: { preview: MissionPreview }) {
  return (
    <div className="flex flex-wrap gap-2 text-xs text-st-muted">
      <span className="rounded border border-st-border px-2 py-0.5">
        Player {props.preview.playerEmpireKey}
      </span>
      <span className="rounded border border-st-border px-2 py-0.5">
        NPC picks {props.preview.npcEmpireCount}
      </span>
      <span className="rounded border border-st-border px-2 py-0.5">
        Automated empires {props.preview.automatedEmpireCount}
      </span>
      <span className="rounded border border-st-border px-2 py-0.5">
        Delayed automation {props.preview.delayedAutomationCount}
      </span>
      <span className="rounded border border-st-border px-2 py-0.5">
        Handicaps {props.preview.handicapCount}
      </span>
    </div>
  );
}

function MissionCard(props: {
  mission: MissionRow;
  onSave: (args: {
    key: string;
    name: string;
    description: string;
    mapKey: string;
    level: number;
    requiredWins: number;
    prerequisiteMissionKeys: string[];
    published: boolean;
    sortOrder: number;
    retentionClass: MissionRow["retentionClass"];
    scenarioJson: string;
  }) => Promise<void>;
}) {
  const [name, setName] = useState(props.mission.name);
  const [description, setDescription] = useState(props.mission.description);
  const [mapKey, setMapKey] = useState(props.mission.mapKey);
  const [level, setLevel] = useState(String(props.mission.level));
  const [requiredWins, setRequiredWins] = useState(String(props.mission.requiredWins));
  const [prerequisitesText, setPrerequisitesText] = useState(
    formatCsv(props.mission.prerequisiteMissionKeys),
  );
  const [published, setPublished] = useState(props.mission.published);
  const [sortOrder, setSortOrder] = useState(String(props.mission.sortOrder));
  const [retentionClass, setRetentionClass] = useState<MissionRow["retentionClass"]>(
    props.mission.retentionClass,
  );
  const [scenarioJson, setScenarioJson] = useState(props.mission.scenarioJson);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    setBusy(true);
    setStatus(null);
    setError(null);
    try {
      await props.onSave({
        key: props.mission.key,
        name,
        description,
        mapKey,
        level: Number(level),
        requiredWins: Number(requiredWins),
        prerequisiteMissionKeys: parseCsv(prerequisitesText),
        published,
        sortOrder: Number(sortOrder),
        retentionClass,
        scenarioJson,
      });
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
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-st-fg">{props.mission.name}</h3>
            <span className="rounded border border-st-border px-2 py-0.5 text-xs text-st-muted">
              {props.mission.key}
            </span>
            <span className="rounded border border-st-border px-2 py-0.5 text-xs text-st-muted">
              Level {props.mission.level}
            </span>
            <span className="rounded border border-st-border px-2 py-0.5 text-xs text-st-muted">
              {published ? "Published" : "Draft"}
            </span>
          </div>
          <p className="mt-1 text-sm text-st-muted">{props.mission.description || "No description."}</p>
          <p className="mt-1 text-xs text-st-muted">
            Updated {formatTimestamp(props.mission.updatedAt)} · Created {formatTimestamp(props.mission.createdAt)}
          </p>
        </div>
        <MissionSummary preview={props.mission.preview} />
      </div>

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
          <span>Map key</span>
          <input
            value={mapKey}
            onChange={(event) => setMapKey(event.target.value)}
            className="rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-fg outline-none focus:border-st-accent"
          />
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
      </div>

      <label className="grid gap-1 text-xs text-st-muted">
        <span>Description</span>
        <input
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          className="rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-fg outline-none focus:border-st-accent"
        />
      </label>

      <div className="grid gap-3 md:grid-cols-[2fr,140px,180px]">
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
      </div>

      <label className="flex items-center gap-2 rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-muted">
        <input
          type="checkbox"
          checked={published}
          onChange={(event) => setPublished(event.target.checked)}
          className="accent-cyan-400"
        />
        Published and available in player progression
      </label>

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

      <div className="flex justify-end">
        <Button type="button" onClick={() => void handleSave()} disabled={busy}>
          {busy ? "Saving..." : "Save mission"}
        </Button>
      </div>
    </Card>
  );
}

function CreateMissionCard(props: {
  onCreate: (args: {
    key: string;
    name: string;
    description: string;
    mapKey: string;
    level: number;
    requiredWins: number;
    prerequisiteMissionKeys: string[];
    published: boolean;
    sortOrder: number;
    retentionClass: MissionRow["retentionClass"];
    scenarioJson: string;
  }) => Promise<void>;
}) {
  const [key, setKey] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [mapKey, setMapKey] = useState("v1-twenty");
  const [level, setLevel] = useState("1");
  const [requiredWins, setRequiredWins] = useState("1");
  const [prerequisitesText, setPrerequisitesText] = useState("");
  const [published, setPublished] = useState(true);
  const [sortOrder, setSortOrder] = useState("100");
  const [retentionClass, setRetentionClass] = useState<MissionRow["retentionClass"]>("official");
  const [scenarioJson, setScenarioJson] = useState(
    JSON.stringify(
      {
        playerEmpireKey: "aurora",
        npcEmpireKeys: [],
        automatedEmpireKeys: [],
        empireConfigs: [],
      },
      null,
      2,
    ),
  );
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
        mapKey,
        level: Number(level),
        requiredWins: Number(requiredWins),
        prerequisiteMissionKeys: parseCsv(prerequisitesText),
        published,
        sortOrder: Number(sortOrder),
        retentionClass,
        scenarioJson,
      });
      setKey("");
      setName("");
      setDescription("");
      setMapKey("v1-twenty");
      setLevel("1");
      setRequiredWins("1");
      setPrerequisitesText("");
      setPublished(true);
      setSortOrder("100");
      setRetentionClass("official");
      setScenarioJson(
        JSON.stringify(
          {
            playerEmpireKey: "aurora",
            npcEmpireKeys: [],
            automatedEmpireKeys: [],
            empireConfigs: [],
          },
          null,
          2,
        ),
      );
      setStatus("Created mission.");
    } catch (createError) {
      setError(mutationErrorMessage(createError));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="space-y-4">
      <div>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-st-muted">Create Mission</h2>
        <p className="mt-1 text-sm text-st-muted">
          Mission keys are stable slugs. Sequence progression with level, prerequisites, and required wins.
        </p>
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
            <span>Map key</span>
            <input
              value={mapKey}
              onChange={(event) => setMapKey(event.target.value)}
              className="rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-fg outline-none focus:border-st-accent"
            />
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
        </div>

        <label className="grid gap-1 text-xs text-st-muted">
          <span>Description</span>
          <input
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            className="rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-fg outline-none focus:border-st-accent"
          />
        </label>

        <div className="grid gap-3 md:grid-cols-[140px,180px,1fr,180px]">
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
        </div>

        <label className="flex items-center gap-2 rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-muted">
          <input
            type="checkbox"
            checked={published}
            onChange={(event) => setPublished(event.target.checked)}
            className="accent-cyan-400"
          />
          Published and available to players
        </label>

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

        <div className="flex justify-end">
          <Button type="submit" disabled={busy}>
            {busy ? "Creating..." : "Create mission"}
          </Button>
        </div>
      </form>
    </Card>
  );
}

export function AdminMissionsPage() {
  const missionsQuery = useQuery(api.admin.queries.listMissions, {
    publishedOnly: false,
    fallbackToBuiltIns: false,
  });
  const strategiesQuery = useQuery(api.admin.queries.listAutomationStrategies, {});
  const npcQuery = useQuery(api.admin.queries.listEmpireNpcPlayers, {
    includeInactive: false,
    fallbackToBuiltIns: false,
  });
  const createMission = useMutation(api.admin.mutations.createMission);
  const updateMission = useMutation(api.admin.mutations.updateMission);
  const seedMissingMissions = useMutation(api.admin.mutations.seedMissingMissions);
  const [seedBusy, setSeedBusy] = useState(false);
  const [seedStatus, setSeedStatus] = useState<string | null>(null);
  const [seedError, setSeedError] = useState<string | null>(null);

  const missions = missionsQuery?.authorized ? (missionsQuery.missions as MissionRow[]) : [];
  const strategies = useMemo(
    () =>
      strategiesQuery?.authorized
        ? ((strategiesQuery.strategies as StrategyOption[]).filter((strategy) => strategy.availableForNpcs))
        : [],
    [strategiesQuery],
  );
  const empireNpcs = useMemo(
    () => (npcQuery?.authorized ? (npcQuery.empireNpcs as EmpireNpcRow[]) : []),
    [npcQuery],
  );

  async function handleSeedBuiltIns() {
    setSeedBusy(true);
    setSeedStatus(null);
    setSeedError(null);
    try {
      const result = await seedMissingMissions({});
      setSeedStatus(`Seeded ${result.inserted} built-in missions. Skipped ${result.skipped}.`);
    } catch (error) {
      setSeedError(mutationErrorMessage(error));
    } finally {
      setSeedBusy(false);
    }
  }

  if (missionsQuery === undefined || strategiesQuery === undefined || npcQuery === undefined) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-6">
        <Card className="text-sm text-st-muted">Loading missions...</Card>
      </div>
    );
  }

  if (!missionsQuery.authorized) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-6">
        <Card className="text-sm text-st-muted">Sign in to manage missions.</Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-6">
      <Card className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-st-muted">Admin</p>
            <h1 className="text-2xl font-semibold text-st-fg">Missions</h1>
            <p className="mt-2 max-w-3xl text-sm text-st-muted">
              Edit the mission catalog that drives player progression. Each mission record controls map choice,
              sequencing, required wins, and scenario JSON for player empire, NPC strategy activation, and handicaps.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded border border-st-border px-3 py-2 text-xs text-st-muted">
              {missions.length} missions
            </span>
            <Button type="button" variant="secondary" onClick={() => void handleSeedBuiltIns()} disabled={seedBusy}>
              {seedBusy ? "Seeding..." : "Seed built-ins"}
            </Button>
          </div>
        </div>
        {seedStatus !== null ? <p className="text-sm text-emerald-300">{seedStatus}</p> : null}
        {seedError !== null ? <p className="text-sm text-red-300">{seedError}</p> : null}
      </Card>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr),320px]">
        <div className="space-y-4">
          <CreateMissionCard
            onCreate={async (args) => {
              await createMission(args);
            }}
          />
          {missions.length === 0 ? (
            <Card className="text-sm text-st-muted">
              No missions are stored yet. Seed the built-ins or create the first mission manually.
            </Card>
          ) : (
            missions
              .slice()
              .sort((left, right) => left.sortOrder - right.sortOrder || left.name.localeCompare(right.name))
              .map((mission) => (
                <MissionCard
                  key={mission.key}
                  mission={mission}
                  onSave={async (args) => {
                    await updateMission(args);
                  }}
                />
              ))
          )}
        </div>

        <div className="space-y-4">
          <Card className="space-y-3">
            <div>
              <h2 className="text-sm font-semibold uppercase tracking-wide text-st-muted">Scenario Keys</h2>
              <p className="mt-1 text-sm text-st-muted">
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
          </Card>

          <Card className="space-y-2 text-xs text-st-muted">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-st-muted">Scenario Notes</h2>
            <p>
              Set <span className="font-mono text-st-fg">playerEmpireKey</span> to the player-controlled empire.
            </p>
            <p>
              Use <span className="font-mono text-st-fg">npcEmpireKeys</span> to seed catalog NPC empires into the map.
            </p>
            <p>
              Use <span className="font-mono text-st-fg">automatedEmpireKeys</span> to turn seeded empires into NPC-controlled factions.
            </p>
            <p>
              Add entries to <span className="font-mono text-st-fg">empireConfigs</span> for strategy start delays, homeworld resource deltas, treasury changes, and display-name overrides.
            </p>
          </Card>
        </div>
      </div>
    </div>
  );
}