import { useEffect, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { useNavigate } from "react-router-dom";
import { api } from "../../../convex/_generated/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useActiveGame } from "@/features/galaxy/hooks/useActiveGame";
import { usePlayerPreview } from "@/features/player/PlayerPreviewContext";
import { cn } from "@/lib/utils";

function formatDateTime(value: number | null): string {
  if (value === null) return "Not started";
  return new Date(value).toLocaleString();
}

function statusClassName(status: string): string {
  if (status === "running") return "border-emerald-500/30 bg-emerald-950/30 text-emerald-200";
  if (status === "paused") return "border-amber-500/30 bg-amber-950/30 text-amber-200";
  if (status === "finished") return "border-slate-500/30 bg-slate-950/30 text-slate-300";
  return "border-cyan-500/30 bg-cyan-950/30 text-cyan-200";
}

function formatStatus(status: string): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

export function PlayerLobbyPage() {
  const { selectedGameId, setSelectedGameId } = useActiveGame();
  const { basePath, empireName } = usePlayerPreview();
  const navigate = useNavigate();
  const lobbyState = useQuery(api.usr.queries.getMyLobbyState, {});
  const ensureMyStarterGames = useMutation(api.usr.mutations.ensureMyStarterGames);
  const resetMyStarterGame = useMutation(api.usr.mutations.resetMyStarterGame);
  const startGame = useMutation(api.sim.mutations.startGame);
  const [busyScenarioKey, setBusyScenarioKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void ensureMyStarterGames().catch((mutationError: Error) => {
      setError(mutationError.message);
    });
  }, [ensureMyStarterGames]);

  function selectGame(gameId: typeof selectedGameId) {
    setSelectedGameId(gameId);
    void navigate(basePath, { replace: true });
  }

  async function onScenarioAction(entry: NonNullable<typeof lobbyState>["games"][number]) {
    if (!entry.unlocked || entry.game === null) {
      return;
    }

    setError(null);
    setBusyScenarioKey(entry.key);
    try {
      if (entry.game.status === "lobby") {
        await startGame({ gameId: entry.game._id });
        selectGame(entry.game._id);
        return;
      }

      if (entry.game.status === "finished") {
        const result = await resetMyStarterGame({ scenarioKey: entry.key });
        setSelectedGameId(result.gameId as typeof selectedGameId);
        void navigate(basePath, { replace: true });
        return;
      }

      selectGame(entry.game._id);
    } catch (mutationError) {
      const message = mutationError instanceof Error ? mutationError.message : String(mutationError);
      setError(message.replace(/^[\s\S]*?Error:\s*/g, "").trim());
    } finally {
      setBusyScenarioKey(null);
    }
  }

  const games = lobbyState?.games ?? [];
  const gamesLoading = lobbyState === undefined;

  function actionLabel(entry: (typeof games)[number]): string {
    if (!entry.unlocked) {
      return "Locked";
    }
    if (entry.game === null) {
      return "Preparing...";
    }
    if (entry.game.status === "lobby") {
      return "Start";
    }
    if (entry.game.status === "finished") {
      return "Replay";
    }
    return "Play";
  }

  return (
    <div className="w-full px-4 py-4 sm:px-6">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-4">
        <Card>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="text-sm font-semibold uppercase tracking-wide text-st-muted">
                Player Lobby
              </h1>
              <p className="mt-2 max-w-3xl text-sm text-st-muted">
                Choose which game <span className="font-medium text-st-fg">{empireName}</span>{" "}
                participates in on <span className="font-mono text-st-fg">{basePath}</span>. The
                selected game is used by the map, empire, economy, fleet, combat, and history pages.
              </p>
            </div>
            <div className="rounded-md border border-st-border bg-st-bg px-3 py-2 text-xs text-st-muted">
              {gamesLoading ? "Loading..." : `${games.length} starter games`}
            </div>
          </div>
        </Card>

        <Card>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold uppercase tracking-wide text-st-muted">
                Progression
              </h2>
              <p className="mt-2 text-sm text-st-muted">
                Win 2 small maps to unlock medium maps. Win 1 medium map to unlock large maps.
              </p>
            </div>
            <div className="grid gap-2 text-sm text-st-muted sm:grid-cols-2">
              <div className="rounded border border-st-border bg-st-bg px-3 py-2">
                Small wins: <span className="font-medium text-st-fg">{lobbyState?.progression.smallWins ?? 0}</span>/2
              </div>
              <div className="rounded border border-st-border bg-st-bg px-3 py-2">
                Medium wins: <span className="font-medium text-st-fg">{lobbyState?.progression.mediumWins ?? 0}</span>/1
              </div>
            </div>
          </div>
        </Card>

        {error ? (
          <Card className="border-red-900/50 bg-red-950/30 text-sm text-red-200">{error}</Card>
        ) : null}

        {gamesLoading ? (
          <Card className="text-sm text-st-muted">Loading games...</Card>
        ) : games.length === 0 ? (
          <Card className="text-sm text-st-muted">
            Preparing your starter games...
          </Card>
        ) : (
          <div className="grid gap-3">
            {games
              .sort((a, b) => a.sortOrder - b.sortOrder)
              .map((entry) => {
              const game = entry.game;
              const isSelected = game !== null && selectedGameId === game._id;
              const isFinishedWin = game?.status === "finished" && game.winnerEmpireKey === "aurora";
              const isFinishedLoss = game?.status === "finished" && game.winnerEmpireKey !== null && game.winnerEmpireKey !== "aurora";
              return (
                <Card
                  key={entry.key}
                  className={cn(
                    "flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between",
                    isSelected ? "border-st-accent" : undefined,
                    !entry.unlocked ? "opacity-70" : undefined,
                  )}
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-base font-semibold text-st-fg">{entry.name}</h2>
                      {game !== null ? (
                        <span
                          className={cn(
                            "rounded-full border px-2 py-0.5 text-xs font-medium",
                            statusClassName(game.status),
                          )}
                        >
                          {formatStatus(game.status)}
                        </span>
                      ) : null}
                      <span className="rounded-full border border-st-border px-2 py-0.5 text-xs font-medium text-st-muted">
                        {entry.mapTier} map
                      </span>
                      <span className="rounded-full border border-st-border px-2 py-0.5 text-xs font-medium text-st-muted">
                        {entry.npcCount} NPC{entry.npcCount === 1 ? "" : "s"}
                      </span>
                      {isSelected ? (
                        <span className="rounded-full border border-st-accent/40 bg-st-accent/10 px-2 py-0.5 text-xs font-medium text-st-accent">
                          Currently viewed
                        </span>
                      ) : null}
                      {isFinishedWin ? (
                        <span className="rounded-full border border-emerald-500/40 bg-emerald-950/30 px-2 py-0.5 text-xs font-medium text-emerald-200">
                          Victory
                        </span>
                      ) : null}
                      {isFinishedLoss ? (
                        <span className="rounded-full border border-red-500/40 bg-red-950/30 px-2 py-0.5 text-xs font-medium text-red-200">
                          Defeat
                        </span>
                      ) : null}
                      {!entry.unlocked ? (
                        <span className="rounded-full border border-amber-500/40 bg-amber-950/30 px-2 py-0.5 text-xs font-medium text-amber-200">
                          Requires {entry.requiredSmallWins} small win{entry.requiredSmallWins === 1 ? "" : "s"}
                        </span>
                      ) : null}
                    </div>
                    <dl className="mt-3 grid gap-2 text-sm text-st-muted sm:grid-cols-4">
                      <div>
                        <dt className="text-xs uppercase tracking-wide">Map</dt>
                        <dd className="mt-0.5 font-mono text-st-fg">{entry.mapKey}</dd>
                      </div>
                      <div>
                        <dt className="text-xs uppercase tracking-wide">Turn</dt>
                        <dd className="mt-0.5 text-st-fg">{game?.currentTurn ?? 0}</dd>
                      </div>
                      <div>
                        <dt className="text-xs uppercase tracking-wide">Started</dt>
                        <dd className="mt-0.5 text-st-fg">{formatDateTime(game?.startedAt ?? null)}</dd>
                      </div>
                      <div>
                        <dt className="text-xs uppercase tracking-wide">Game ID</dt>
                        <dd className="mt-0.5 truncate font-mono text-xs text-st-fg">
                          {game?._id ?? "Preparing..."}
                        </dd>
                      </div>
                    </dl>
                    {!entry.unlocked ? (
                      <p className="mt-3 text-xs text-st-muted">
                        This scenario unlocks after you reach {entry.requiredSmallWins} small-map wins.
                      </p>
                    ) : null}
                  </div>
                  <Button
                    type="button"
                    variant={isSelected && game?.status !== "finished" ? "secondary" : "primary"}
                    className="shrink-0"
                    disabled={!entry.unlocked || game === null || busyScenarioKey === entry.key}
                    onClick={() => void onScenarioAction(entry)}
                  >
                    {busyScenarioKey === entry.key ? "Working..." : actionLabel(entry)}
                  </Button>
                </Card>
              );
            })}
          </div>
        )}

        <Card>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-st-muted">
            Large Maps
          </h2>
          <p className="mt-2 text-sm text-st-muted">
            Large map games unlock after 1 medium-map victory.
            {lobbyState?.progression.largeUnlocked
              ? " Large scenarios are unlocked for your account."
              : " Finish Game 3 to unlock them."}
          </p>
        </Card>
      </div>
    </div>
  );
}
