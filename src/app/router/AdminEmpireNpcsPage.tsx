import { FormEvent, useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

type StrategyPreview = {
  stance: string;
  earlyRush: boolean;
  reserveShipsPct: number;
  reinforceAttackedSystems: boolean;
} | null;

type EmpireNpcRow = {
  key: string;
  playerName: string;
  empireName: string;
  colorHex: string;
  strategyLibraryKey: string | null;
  defaultStrategy: {
    key: string;
    name: string;
    description: string;
    preview: StrategyPreview;
  } | null;
  isActive: boolean;
  sortOrder: number;
};

type StrategyOption = {
  key: string;
  name: string;
  availableForNpcs: boolean;
  preview: StrategyPreview;
};

function mutationErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  return raw.replace(/^[\s\S]*?Error:\s*/g, "").trim() || "Something went wrong.";
}

function StrategyPreviewLabel(props: { preview: StrategyPreview }) {
  if (props.preview === null) {
    return <span>No preview</span>;
  }

  return (
    <span>
      {props.preview.stance} · {props.preview.reserveShipsPct}% reserve
      {props.preview.earlyRush ? " · rush" : ""}
    </span>
  );
}

function EmpireNpcCard(props: {
  npc: EmpireNpcRow;
  strategies: StrategyOption[];
  onSave: (args: {
    key: string;
    playerName: string;
    empireName: string;
    colorHex: string;
    strategyLibraryKey: string | null;
    isActive: boolean;
    sortOrder: number;
  }) => Promise<void>;
}) {
  const [playerName, setPlayerName] = useState(props.npc.playerName);
  const [empireName, setEmpireName] = useState(props.npc.empireName);
  const [colorHex, setColorHex] = useState(props.npc.colorHex);
  const [strategyLibraryKey, setStrategyLibraryKey] = useState(props.npc.strategyLibraryKey ?? "");
  const [isActive, setIsActive] = useState(props.npc.isActive);
  const [sortOrder, setSortOrder] = useState(String(props.npc.sortOrder));
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    setBusy(true);
    setStatus(null);
    setError(null);
    try {
      await props.onSave({
        key: props.npc.key,
        playerName,
        empireName,
        colorHex,
        strategyLibraryKey: strategyLibraryKey.trim().length === 0 ? null : strategyLibraryKey,
        isActive,
        sortOrder: Number(sortOrder),
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
            <h3 className="text-sm font-semibold text-st-fg">{props.npc.playerName}</h3>
            <span className="rounded border border-st-border px-2 py-0.5 text-xs text-st-muted">
              {props.npc.key}
            </span>
            <span className="rounded border border-st-border px-2 py-0.5 text-xs text-st-muted">
              {isActive ? "Active" : "Inactive"}
            </span>
          </div>
          <p className="mt-1 text-sm text-st-muted">{props.npc.empireName}</p>
          <p className="mt-1 text-xs text-st-muted">
            Default strategy: {props.npc.defaultStrategy === null ? "None" : props.npc.defaultStrategy.name}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span
            className="h-8 w-8 rounded-full border border-st-border"
            style={{ backgroundColor: colorHex }}
            aria-hidden="true"
          />
          <span className="font-mono text-xs text-st-muted">{colorHex}</span>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <label className="grid gap-1 text-xs text-st-muted">
          <span>Player name</span>
          <input
            value={playerName}
            onChange={(event) => setPlayerName(event.target.value)}
            className="rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-fg outline-none focus:border-st-accent"
          />
        </label>
        <label className="grid gap-1 text-xs text-st-muted">
          <span>Empire identity</span>
          <input
            value={empireName}
            onChange={(event) => setEmpireName(event.target.value)}
            className="rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-fg outline-none focus:border-st-accent"
          />
        </label>
      </div>

      <div className="grid gap-3 md:grid-cols-[160px,160px,1fr]">
        <label className="grid gap-1 text-xs text-st-muted">
          <span>Color hex</span>
          <input
            value={colorHex}
            onChange={(event) => setColorHex(event.target.value)}
            className="rounded border border-st-border bg-st-bg px-3 py-2 font-mono text-sm text-st-fg outline-none focus:border-st-accent"
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
          <span>Default strategy</span>
          <select
            value={strategyLibraryKey}
            onChange={(event) => setStrategyLibraryKey(event.target.value)}
            className="rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-fg outline-none focus:border-st-accent"
          >
            <option value="">No default strategy</option>
            {props.strategies.map((strategy) => (
              <option key={strategy.key} value={strategy.key}>
                {strategy.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      {strategyLibraryKey.trim().length > 0 ? (
        <p className="text-xs text-st-muted">
          Preview: <StrategyPreviewLabel preview={props.strategies.find((strategy) => strategy.key === strategyLibraryKey)?.preview ?? null} />
        </p>
      ) : null}

      <label className="flex items-center gap-2 rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-muted">
        <input
          type="checkbox"
          checked={isActive}
          onChange={(event) => setIsActive(event.target.checked)}
          className="accent-cyan-400"
        />
        Available in the game seeder roster
      </label>

      {status !== null ? <p className="text-sm text-emerald-300">{status}</p> : null}
      {error !== null ? <p className="text-sm text-red-300">{error}</p> : null}

      <div className="flex justify-end">
        <Button type="button" onClick={() => void handleSave()} disabled={busy}>
          {busy ? "Saving..." : "Save NPC"}
        </Button>
      </div>
    </Card>
  );
}

function CreateEmpireNpcCard(props: {
  strategies: StrategyOption[];
  onCreate: (args: {
    key: string;
    playerName: string;
    empireName: string;
    colorHex: string;
    strategyLibraryKey: string | null;
    isActive: boolean;
    sortOrder: number;
  }) => Promise<void>;
}) {
  const [key, setKey] = useState("");
  const [playerName, setPlayerName] = useState("");
  const [empireName, setEmpireName] = useState("");
  const [colorHex, setColorHex] = useState("#22c55e");
  const [strategyLibraryKey, setStrategyLibraryKey] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [sortOrder, setSortOrder] = useState("110");
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
        playerName,
        empireName,
        colorHex,
        strategyLibraryKey: strategyLibraryKey.trim().length === 0 ? null : strategyLibraryKey,
        isActive,
        sortOrder: Number(sortOrder),
      });
      setKey("");
      setPlayerName("");
      setEmpireName("");
      setColorHex("#22c55e");
      setStrategyLibraryKey("");
      setIsActive(true);
      setSortOrder("110");
      setStatus("Created NPC player.");
    } catch (createError) {
      setError(mutationErrorMessage(createError));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="space-y-4">
      <div>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-st-muted">Create NPC</h2>
        <p className="mt-1 text-sm text-st-muted">
          Add a new empire NPC persona to the catalog used by game setup and mission tooling.
        </p>
      </div>

      <form className="space-y-4" onSubmit={(event) => void handleCreate(event)}>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="grid gap-1 text-xs text-st-muted">
            <span>Key</span>
            <input
              value={key}
              onChange={(event) => setKey(event.target.value)}
              placeholder="nova-sable"
              className="rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-fg outline-none focus:border-st-accent"
            />
          </label>
          <label className="grid gap-1 text-xs text-st-muted">
            <span>Player name</span>
            <input
              value={playerName}
              onChange={(event) => setPlayerName(event.target.value)}
              placeholder="Nova Sable"
              className="rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-fg outline-none focus:border-st-accent"
            />
          </label>
        </div>

        <label className="grid gap-1 text-xs text-st-muted">
          <span>Empire identity</span>
          <input
            value={empireName}
            onChange={(event) => setEmpireName(event.target.value)}
            placeholder="Sable Regency"
            className="rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-fg outline-none focus:border-st-accent"
          />
        </label>

        <div className="grid gap-3 md:grid-cols-[160px,160px,1fr]">
          <label className="grid gap-1 text-xs text-st-muted">
            <span>Color hex</span>
            <input
              value={colorHex}
              onChange={(event) => setColorHex(event.target.value)}
              className="rounded border border-st-border bg-st-bg px-3 py-2 font-mono text-sm text-st-fg outline-none focus:border-st-accent"
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
            <span>Default strategy</span>
            <select
              value={strategyLibraryKey}
              onChange={(event) => setStrategyLibraryKey(event.target.value)}
              className="rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-fg outline-none focus:border-st-accent"
            >
              <option value="">No default strategy</option>
              {props.strategies.map((strategy) => (
                <option key={strategy.key} value={strategy.key}>
                  {strategy.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label className="flex items-center gap-2 rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-muted">
          <input
            type="checkbox"
            checked={isActive}
            onChange={(event) => setIsActive(event.target.checked)}
            className="accent-cyan-400"
          />
          Available in the game seeder roster
        </label>

        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-st-muted">Default strategy must be NPC-enabled in the shared strategy catalog.</p>
          <Button type="submit" disabled={busy}>
            {busy ? "Creating..." : "Create NPC"}
          </Button>
        </div>

        {status !== null ? <p className="text-sm text-emerald-300">{status}</p> : null}
        {error !== null ? <p className="text-sm text-red-300">{error}</p> : null}
      </form>
    </Card>
  );
}

export function AdminEmpireNpcsPage() {
  const npcQuery = useQuery(api.admin.queries.listEmpireNpcPlayers, {
    includeInactive: true,
    fallbackToBuiltIns: false,
  });
  const strategiesQuery = useQuery(api.admin.queries.listAutomationStrategies, {});
  const createEmpireNpcPlayer = useMutation(api.admin.mutations.createEmpireNpcPlayer);
  const updateEmpireNpcPlayer = useMutation(api.admin.mutations.updateEmpireNpcPlayer);
  const seedMissingEmpireNpcPlayers = useMutation(api.admin.mutations.seedMissingEmpireNpcPlayers);

  const strategies = useMemo(
    () =>
      (strategiesQuery?.authorized ? strategiesQuery.strategies : [])
        .filter((strategy) => strategy.availableForNpcs)
        .map((strategy) => ({
          key: strategy.key,
          name: strategy.name,
          availableForNpcs: strategy.availableForNpcs,
          preview: strategy.preview,
        })),
    [strategiesQuery],
  );

  const empireNpcs = npcQuery?.authorized ? (npcQuery.empireNpcs as EmpireNpcRow[]) : [];

  return (
    <div className="mx-auto max-w-[86.4rem] space-y-6 px-4 py-6">
      <Card className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-st-muted">Admin</p>
        <h1 className="text-2xl font-semibold text-st-fg">Empire NPCs</h1>
        <p className="text-sm text-st-muted">
          Manage the empire NPC personas used by the game seeder, including identity, availability, ordering, and default automation strategy.
        </p>
      </Card>

      {npcQuery?.authorized === false ? (
        <Card className="text-sm text-st-muted">Authentication required.</Card>
      ) : (
        <div className="grid gap-4 xl:grid-cols-[0.95fr,1.05fr]">
          <CreateEmpireNpcCard
            strategies={strategies}
            onCreate={async (args) => {
              await createEmpireNpcPlayer(args);
            }}
          />

          <Card className="space-y-3">
            <div>
              <h2 className="text-sm font-semibold uppercase tracking-wide text-st-muted">Catalog Summary</h2>
              <p className="mt-1 text-sm text-st-muted">
                {npcQuery === undefined
                  ? "Loading NPC catalog..."
                  : `${empireNpcs.length} empire NPC record${empireNpcs.length === 1 ? "" : "s"} in the shared roster.`}
              </p>
            </div>

            <div className="grid gap-2 sm:grid-cols-2">
              <div className="rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-muted">
                Active: <span className="font-medium text-st-fg">{empireNpcs.filter((npc) => npc.isActive).length}</span>
              </div>
              <div className="rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-muted">
                With default strategy: <span className="font-medium text-st-fg">{empireNpcs.filter((npc) => npc.strategyLibraryKey !== null).length}</span>
              </div>
            </div>

            <p className="text-xs text-st-muted">
              Built-in roster NPCs can be seeded into the database once, then edited in place from this page.
            </p>

            <div className="flex flex-wrap justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => void seedMissingEmpireNpcPlayers()}
              >
                Seed missing built-ins
              </Button>
            </div>
          </Card>
        </div>
      )}

      {npcQuery === undefined ? (
        <Card className="text-sm text-st-muted">Loading empire NPC catalog...</Card>
      ) : empireNpcs.length === 0 ? (
        <Card className="text-sm text-st-muted">
          No empire NPCs are seeded yet. Seed the built-in roster, then edit defaults and availability here.
        </Card>
      ) : (
        <div className="space-y-4">
          {empireNpcs.map((npc) => (
            <EmpireNpcCard
              key={npc.key}
              npc={npc}
              strategies={strategies}
              onSave={async (args) => {
                await updateEmpireNpcPlayer(args);
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}