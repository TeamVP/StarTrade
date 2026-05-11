import { FormEvent, useState, type MouseEvent } from "react";
import { useMutation } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useActiveGame } from "@/features/galaxy/hooks/useActiveGame";
import { GodModePanel } from "./GodModePanel";

function mutationErrorMessage(error: unknown): string {
  const text =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "";
  if (text.includes("already seeded")) {
    return "This game is already seeded.";
  }
  const stripped = text.replace(/^[\s\S]*?Error:\s*/g, "").trim() || text;
  return stripped || "Something went wrong.";
}

export function AdminPanel() {
  const { games, activeGame, setSelectedGameId } = useActiveGame();
  const createGame = useMutation(api.sim.mutations.createGame);
  const reseedGame = useMutation(api.admin.mutations.reseedGame);
  const repairGameEconomy = useMutation(api.admin.mutations.repairGameEconomy);
  const [creating, setCreating] = useState(false);
  const [seedingGameId, setSeedingGameId] = useState<Id<"sim_games"> | null>(null);
  const [seedError, setSeedError] = useState<string | null>(null);
  const [godModeOpen, setGodModeOpen] = useState(false);
  const [repairing, setRepairing] = useState(false);
  const [repairResult, setRepairResult] = useState<string | null>(null);

  async function onCreateGame(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    const nameValue = formData.get("name");
    const mapKeyValue = formData.get("mapKey");
    const seedValue = formData.get("seed");
    const name = typeof nameValue === "string" ? nameValue.trim() : "";
    const mapKey = typeof mapKeyValue === "string" ? mapKeyValue.trim() : "";
    const seed = typeof seedValue === "string" ? seedValue.trim() : "";

    if (!name || !mapKey || !seed) return;

    setCreating(true);
    try {
      const newGameId = await createGame({
        name,
        mapKey,
        turnDurationMs: 15000,
        seed,
      });
      setSelectedGameId(newGameId);
      form.reset();
    } finally {
      setCreating(false);
    }
  }

  async function onSeed(gameId: Id<"sim_games">, mapKey: string, event: MouseEvent) {
    event.stopPropagation();
    setSeedError(null);
    setSeedingGameId(gameId);
    try {
      await reseedGame({
        gameId,
        mapKey,
      });
    } catch (e) {
      setSeedError(mutationErrorMessage(e));
    } finally {
      setSeedingGameId(null);
    }
  }

  return (
    <Card>
      <h2 className="text-sm font-semibold uppercase tracking-wide text-st-muted">
        Admin Seeder
      </h2>
      <form className="mt-3 space-y-2" onSubmit={(event) => void onCreateGame(event)}>
        <input
          name="name"
          placeholder="Game name"
          className="w-full rounded border border-st-border bg-st-bg px-3 py-2 text-sm"
        />
        <input
          name="mapKey"
          placeholder="v1-twenty | v1-core | v1-large"
          defaultValue="v1-twenty"
          className="w-full rounded border border-st-border bg-st-bg px-3 py-2 text-sm"
        />
        <input
          name="seed"
          defaultValue="seed-001"
          className="w-full rounded border border-st-border bg-st-bg px-3 py-2 text-sm"
        />
        <Button
          type="submit"
          disabled={creating}
          className="w-full"
        >
          {creating ? "Creating..." : "Create Game"}
        </Button>
      </form>

      {seedError !== null ? (
        <p className="mt-3 text-sm text-red-600 dark:text-red-400" role="alert">
          {seedError}
        </p>
      ) : null}

      <div className="mt-4 space-y-2">
        <p className="text-xs text-st-muted">Click a game to focus the map and panels on it.</p>
        {games.map((game) => {
          const isFocused = activeGame?._id === game._id;
          return (
            <div
              key={game._id}
              role="button"
              tabIndex={0}
              onClick={() => setSelectedGameId(game._id)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  setSelectedGameId(game._id);
                }
              }}
              className={`flex cursor-pointer items-center justify-between rounded border px-3 py-2 text-sm transition-colors ${
                isFocused
                  ? "border-st-accent bg-st-accent/10 ring-1 ring-st-accent/30"
                  : "border-st-border hover:bg-st-bg/80"
              }`}
            >
              <div>
                <p className="font-medium">{game.name}</p>
                <p className="text-xs text-st-muted">{game.mapKey}</p>
              </div>
              <Button
                type="button"
                className="px-2 py-1 text-xs"
                disabled={seedingGameId === game._id}
                onClick={(event) => void onSeed(game._id, game.mapKey, event)}
              >
                {seedingGameId === game._id ? "Seeding..." : "Seed"}
              </Button>
            </div>
          );
        })}
      </div>

      {activeGame != null && (
        <div className="mt-4 border-t border-st-border pt-4 space-y-3">
          <div>
            <p className="text-xs text-st-muted mb-1">
              Restores food stockpiles, minimum population, and clears battle-damage
              penalties on all owned systems — use when a live game has been damaged by
              the starvation spiral.
            </p>
            <Button
              type="button"
              disabled={repairing}
              className="w-full text-xs"
              onClick={() => {
                setRepairResult(null);
                setRepairing(true);
                void repairGameEconomy({ gameId: activeGame._id })
                  .then((r) => {
                    setRepairResult(
                      `Repaired ${r.repairedSystems} systems, ${r.repairedHoldings} holdings.`,
                    );
                  })
                  .catch((e: unknown) => {
                    setRepairResult(mutationErrorMessage(e));
                  })
                  .finally(() => setRepairing(false));
              }}
            >
              {repairing ? "Repairing…" : "🔧 Repair Economy — " + activeGame.name}
            </Button>
            {repairResult !== null && (
              <p className="mt-1 text-xs text-emerald-400">{repairResult}</p>
            )}
          </div>

          <button
            type="button"
            onClick={() => setGodModeOpen((o) => !o)}
            className="flex w-full items-center justify-between text-xs font-semibold uppercase tracking-widest text-amber-400 hover:text-amber-300 transition-colors"
          >
            <span>⚡ God Mode — {activeGame.name}</span>
            <span className="text-st-muted font-normal normal-case tracking-normal">
              {godModeOpen ? "▲ hide" : "▼ show"}
            </span>
          </button>
          {godModeOpen && (
            <div className="mt-3">
              <GodModePanel gameId={activeGame._id} />
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
