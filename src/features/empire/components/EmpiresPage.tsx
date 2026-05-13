import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import type { Doc } from "../../../../convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useActiveGame } from "@/features/galaxy/hooks/useActiveGame";
import {
  formatStrategyJson,
  NPC_EMPIRE_STRATEGIES,
} from "@/features/empire/strategies/npcStrategies";

function formatStrategyText(strategyJson: string | undefined): string {
  if (strategyJson === undefined) return "";
  try {
    return JSON.stringify(JSON.parse(strategyJson), null, 2);
  } catch {
    return strategyJson;
  }
}

function validateStrategyText(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    throw new Error("Strategy JSON cannot be empty.");
  }
  const parsed: unknown = JSON.parse(trimmed);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("Strategy JSON must be a JSON object.");
  }
  return JSON.stringify(parsed, null, 2);
}

function EmpireEditor({ empire }: { empire: Doc<"emp_states"> }) {
  const updateEmpireMeta = useMutation(api.emp.mutations.updateEmpireMeta);
  const [name, setName] = useState(empire.name);
  const [colorHex, setColorHex] = useState(empire.colorHex);
  const [playerName, setPlayerName] = useState(empire.playerName ?? "");
  const [strategyText, setStrategyText] = useState(formatStrategyText(empire.strategyJson));
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const defaultStrategy = useMemo(() => {
    if (empire.npcPlayerKey === undefined) return undefined;
    return NPC_EMPIRE_STRATEGIES[empire.npcPlayerKey];
  }, [empire.npcPlayerKey]);

  async function saveProfile(nextColorHex = colorHex) {
    setIsSaving(true);
    setError(null);
    setStatus(null);
    try {
      await updateEmpireMeta({
        empireId: empire._id,
        name,
        colorHex: nextColorHex,
        playerName,
      });
      setStatus("Saved profile.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save profile.");
    } finally {
      setIsSaving(false);
    }
  }

  async function saveStrategy() {
    setIsSaving(true);
    setError(null);
    setStatus(null);
    try {
      const normalized = validateStrategyText(strategyText);
      await updateEmpireMeta({
        empireId: empire._id,
        strategyJson: normalized,
      });
      setStrategyText(normalized);
      setStatus("Saved strategy.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Strategy JSON is invalid.");
    } finally {
      setIsSaving(false);
    }
  }

  function loadDefaultStrategy() {
    if (defaultStrategy === undefined) return;
    setStrategyText(formatStrategyJson(defaultStrategy));
    setStatus("Loaded default strategy. Save to persist it.");
    setError(null);
  }

  return (
    <Card>
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <input
              type="color"
              value={colorHex}
              onChange={(event) => {
                const next = event.target.value;
                setColorHex(next);
                void saveProfile(next);
              }}
              aria-label={`Empire color for ${empire.name}`}
              className="h-10 w-10 cursor-pointer rounded border border-st-border bg-st-panel"
            />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="truncate text-base font-semibold text-st-fg">{empire.name}</h2>
                <span className="rounded border border-st-border px-2 py-0.5 text-[11px] uppercase tracking-wide text-st-muted">
                  {empire.controller === "npc" ? "NPC" : "Human"}
                </span>
              </div>
              <p className="text-xs text-st-muted">
                {empire.playerName ?? "No player name set"}
                {empire.npcPlayerKey !== undefined ? ` · ${empire.npcPlayerKey}` : ""}
              </p>
            </div>
          </div>
          <Button type="button" onClick={() => void saveProfile()} disabled={isSaving}>
            Save Profile
          </Button>
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          <label className="space-y-1 text-xs text-st-muted">
            <span>Empire Name</span>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              onBlur={() => void saveProfile()}
              className="w-full rounded border border-st-border bg-st-panel px-3 py-2 text-sm text-st-fg outline-none focus:border-st-accent"
            />
          </label>
          <label className="space-y-1 text-xs text-st-muted">
            <span>Player Name</span>
            <input
              value={playerName}
              onChange={(event) => setPlayerName(event.target.value)}
              onBlur={() => void saveProfile()}
              className="w-full rounded border border-st-border bg-st-panel px-3 py-2 text-sm text-st-fg outline-none focus:border-st-accent"
            />
          </label>
          <label className="space-y-1 text-xs text-st-muted">
            <span>Color Hex</span>
            <input
              value={colorHex}
              onChange={(event) => setColorHex(event.target.value)}
              onBlur={() => void saveProfile()}
              className="w-full rounded border border-st-border bg-st-panel px-3 py-2 font-mono text-sm text-st-fg outline-none focus:border-st-accent"
            />
          </label>
        </div>

        <details className="rounded-lg border border-st-border bg-st-panel/60 p-3">
          <summary className="cursor-pointer text-sm font-medium text-st-fg">
            Automation Strategy
          </summary>
          <div className="mt-3 space-y-3">
            <p className="text-xs text-st-muted">
              Save a JSON brain for NPC empires or human empires that should run on scriptable
              automation. The turn runner applies economy settings and maintains strategy-managed
              standing routes for expansion, border reinforcement, and attacks.
            </p>
            <textarea
              value={strategyText}
              onChange={(event) => setStrategyText(event.target.value)}
              rows={16}
              spellCheck={false}
              className="w-full rounded border border-st-border bg-slate-950/60 px-3 py-2 font-mono text-xs text-st-fg outline-none focus:border-st-accent"
              placeholder='{"archetype":"Balanced Strategist","economy":{"taxRateTarget":0.14}}'
            />
            <div className="flex flex-wrap gap-2">
              <Button type="button" onClick={() => void saveStrategy()} disabled={isSaving}>
                Save Strategy
              </Button>
              {defaultStrategy !== undefined ? (
                <Button type="button" variant="secondary" onClick={loadDefaultStrategy}>
                  Load Default
                </Button>
              ) : null}
            </div>
          </div>
        </details>

        {status !== null ? <p className="text-xs text-emerald-400">{status}</p> : null}
        {error !== null ? <p className="text-xs text-red-400">{error}</p> : null}
      </div>
    </Card>
  );
}

export function EmpiresPage() {
  const { activeGame, games, setSelectedGameId } = useActiveGame();
  const empires =
    useQuery(
      api.emp.queries.listEmpires,
      activeGame ? { gameId: activeGame._id, limit: 64 } : "skip",
    ) ?? [];

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-6">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold text-st-fg">Empires</h1>
        <p className="text-sm text-st-muted">
          Manage empire identity, colors, and automation brains for human and NPC players. Empire
          colors you set here are saved to your account and applied when you create or seed a new
          map for Aurora, Iron, and each roster NPC persona.
        </p>
      </div>

      {games.length > 1 ? (
        <div className="flex flex-wrap gap-2">
          {games.map((game) => {
            const isActive = activeGame?._id === game._id;
            return (
              <button
                key={game._id}
                type="button"
                onClick={() => setSelectedGameId(game._id)}
                className={`rounded-md border px-3 py-1.5 text-sm transition-colors ${
                  isActive
                    ? "border-st-accent bg-st-accent/10 text-st-fg ring-1 ring-st-accent/30"
                    : "border-st-border text-st-muted hover:bg-st-panel hover:text-st-fg"
                }`}
              >
                {game.name}
                <span className="ml-1.5 text-xs opacity-60">{game.status}</span>
              </button>
            );
          })}
        </div>
      ) : null}

      {activeGame === null ? (
        <Card>
          <p className="text-sm text-st-muted">
            No game found. Create a game from the Admin panel first.
          </p>
        </Card>
      ) : (
        <>
          <div className="flex items-center gap-2 text-xs text-st-muted">
            <span className="font-medium text-st-fg">{activeGame.name}</span>
            <span>·</span>
            <span className="capitalize">{activeGame.status}</span>
            <span>·</span>
            <span>Turn {activeGame.currentTurn}</span>
          </div>

          <div className="space-y-4">
            {empires.length > 0 ? (
              empires.map((empire) => <EmpireEditor key={empire._id} empire={empire} />)
            ) : (
              <Card>
                <p className="text-sm text-st-muted">No empires have been seeded yet.</p>
              </Card>
            )}
          </div>
        </>
      )}
    </div>
  );
}
