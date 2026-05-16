import { useEffect, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { Link, useNavigate } from "react-router-dom";
import { Lock } from "lucide-react";
import { api } from "../../../convex/_generated/api";
import { Card } from "@/components/ui/card";
import { getGamePath, getGameRouteKey } from "@/features/games/gameRoutes";
import { useActiveGame } from "@/features/galaxy/hooks/useActiveGame";
import { cn } from "@/lib/utils";

function formatDateTime(value: number | null): string {
  if (value === null) return "Not started";
  return new Date(value).toLocaleString();
}

function formatRelativeDateTime(value: number | null): string {
  if (value === null) return "Not started";

  const diffMs = value - Date.now();
  const absDiffMs = Math.abs(diffMs);

  if (absDiffMs < 60_000) {
    return "Just now";
  }

  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  const units = [
    ["day", 86_400_000],
    ["hour", 3_600_000],
    ["minute", 60_000],
  ] as const;

  for (const [unit, unitMs] of units) {
    if (absDiffMs >= unitMs) {
      return formatter.format(Math.round(diffMs / unitMs), unit);
    }
  }

  return "Just now";
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

function isActivationKey(key: string): boolean {
  return key === "Enter" || key === " ";
}

function cardAccentClass(
  status: string | undefined,
  isFinishedWin: boolean,
  isFinishedLoss: boolean,
  unlocked: boolean,
): string {
  if (!unlocked) return "bg-slate-700/60";
  if (status === "running") return "bg-emerald-500";
  if (status === "paused") return "bg-amber-400";
  if (isFinishedWin) return "bg-cyan-400";
  if (isFinishedLoss) return "bg-red-500/70";
  return "bg-cyan-600/40";
}

export function LobbyPage() {
  const { selectedGameId, setSelectedGameId } = useActiveGame();
  const navigate = useNavigate();
  const lobbyState = useQuery(api.usr.queries.getMyLobbyState, {});
  const ensureMyStarterGames = useMutation(api.usr.mutations.ensureMyStarterGames);
  const resetMyStarterGame = useMutation(api.usr.mutations.resetMyStarterGame);
  const resignFromGame = useMutation(api.usr.mutations.resignFromGame);
  const [busyScenarioKey, setBusyScenarioKey] = useState<string | null>(null);
  const [resignBusyScenarioKey, setResignBusyScenarioKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void ensureMyStarterGames().catch((mutationError: Error) => {
      setError(mutationError.message);
    });
  }, [ensureMyStarterGames]);

  function selectGame(gameId: typeof selectedGameId, routeKey?: string | null) {
    setSelectedGameId(gameId);
    void navigate(`/game/${routeKey ?? gameId}`);
  }

  async function onScenarioAction(entry: NonNullable<typeof lobbyState>["games"][number]) {
    if (!entry.unlocked || entry.game === null) {
      return;
    }

    setError(null);
    setBusyScenarioKey(entry.key);
    try {
      if (entry.game.status === "finished" || !entry.isActiveMember) {
        const result = await resetMyStarterGame({ scenarioKey: entry.key });
        setSelectedGameId(result.gameId as typeof selectedGameId);
        void navigate(`/game/${result.gameId}`);
        return;
      }

      if (entry.game.status === "lobby") {
        selectGame(entry.game._id, entry.game.urlCode);
        return;
      }

      selectGame(entry.game._id, entry.game.urlCode);
    } catch (mutationError) {
      const message = mutationError instanceof Error ? mutationError.message : String(mutationError);
      setError(message.replace(/^[\s\S]*?Error:\s*/g, "").trim());
    } finally {
      setBusyScenarioKey(null);
    }
  }

  async function onScenarioResign(entry: NonNullable<typeof lobbyState>["games"][number]) {
    if (entry.game === null || !entry.isActiveMember || entry.game.status === "finished") {
      return;
    }
    if (
      !window.confirm(
        "Resign from this game? If no human players remain, the game will end immediately, write final results, and begin cleanup.",
      )
    ) {
      return;
    }

    setError(null);
    setResignBusyScenarioKey(entry.key);
    try {
      await resignFromGame({ gameId: entry.game._id });
    } catch (mutationError) {
      const message = mutationError instanceof Error ? mutationError.message : String(mutationError);
      setError(message.replace(/^[\s\S]*?Error:\s*/g, "").trim());
    } finally {
      setResignBusyScenarioKey(null);
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
    if (entry.game.status === "finished" || !entry.isActiveMember) {
      return "New game";
    }
    if (entry.game.status === "lobby") {
      return "Start";
    }
    return "Continue";
  }

  return (
    <div className="w-full px-4 py-4 sm:px-6">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-4">

        {/* ── Progress banner ───────────────────────────────────────────────── */}
        <div className="relative overflow-hidden rounded-xl border border-cyan-500/20 bg-linear-to-br from-st-panel via-slate-900/80 to-cyan-950/30 px-6 py-5">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_70%_80%_at_100%_50%,rgba(34,211,238,0.07),transparent)]" />
          <div className="relative flex flex-wrap items-center justify-between gap-5">
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-st-muted">Progress</p>
              <div className="mt-2 flex items-baseline gap-2">
                <span className="text-5xl font-bold tabular-nums text-st-fg">
                  {lobbyState?.progression.currentLevel ?? 1}
                </span>
                <span className="text-base font-medium text-st-muted">/ Level</span>
              </div>
            </div>
            <div className="flex min-w-55 flex-1 flex-col gap-2 sm:max-w-xs">
              <div className="flex justify-between text-xs text-st-muted">
                <span>Missions complete</span>
                <span className="font-semibold text-st-fg">
                  {lobbyState?.progression.completedMissionCount ?? 0}
                  <span className="font-normal text-st-muted">
                    &thinsp;/&thinsp;{lobbyState?.progression.totalMissionCount ?? 0}
                  </span>
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-st-border">
                <div
                  className="h-full rounded-full bg-linear-to-r from-cyan-600 to-cyan-300 transition-all duration-500"
                  style={{
                    width: `${
                      ((lobbyState?.progression.completedMissionCount ?? 0) /
                        Math.max(lobbyState?.progression.totalMissionCount ?? 1, 1)) *
                      100
                    }%`,
                  }}
                />
              </div>
            </div>
          </div>
        </div>

        {error ? (
          <Card className="border-red-900/50 bg-red-950/30 text-sm text-red-200">{error}</Card>
        ) : null}

        {/* ── Mission cards ──────────────────────────────────────────────────── */}
        {gamesLoading ? (
          <Card className="text-sm text-st-muted">Loading games...</Card>
        ) : games.length === 0 ? (
          <Card className="text-sm text-st-muted">Preparing your missions...</Card>
        ) : (
          <div className="grid gap-3">
            {games
              .sort((a, b) => a.sortOrder - b.sortOrder)
              .map((entry) => {
                const game = entry.game;
                const result = entry.result;
                const isSelected = game !== null && selectedGameId === game._id;
                const isBusy =
                  busyScenarioKey === entry.key || resignBusyScenarioKey === entry.key;
                const isCardClickable = entry.unlocked && game !== null && !isBusy;
                const isFinishedWin =
                  game?.status === "finished" && result?.auroraWasWinner === true;
                const isFinishedLoss =
                  game?.status === "finished" &&
                  result !== null &&
                  result !== undefined &&
                  result.auroraPlacement !== null &&
                  !result.auroraWasWinner;

                return (
                  <div
                    key={entry.key}
                    role={isCardClickable ? "button" : undefined}
                    tabIndex={isCardClickable ? 0 : undefined}
                    aria-disabled={isCardClickable ? undefined : true}
                    className={cn(
                      "relative overflow-hidden rounded-xl border bg-st-panel transition-colors",
                      isSelected
                        ? "border-st-accent"
                        : "border-st-border hover:border-cyan-500/30",
                      isCardClickable && "cursor-pointer focus:outline-none focus:ring-2 focus:ring-cyan-500/40",
                      !entry.unlocked && "opacity-60",
                    )}
                    onClick={() => {
                      if (!isCardClickable) {
                        return;
                      }
                      void onScenarioAction(entry);
                    }}
                    onKeyDown={(event) => {
                      if (!isCardClickable || !isActivationKey(event.key)) {
                        return;
                      }
                      event.preventDefault();
                      void onScenarioAction(entry);
                    }}
                  >
                    {/* Left status stripe */}
                    <div
                      className={cn(
                        "absolute left-0 top-0 h-full w-0.75",
                        cardAccentClass(game?.status, isFinishedWin, isFinishedLoss, entry.unlocked),
                      )}
                    />

                    <div className="flex flex-col gap-4 py-4 pl-6 pr-5 sm:flex-row sm:items-start sm:justify-between">
                      {/* ─ Info column ─ */}
                      <div className="min-w-0 flex-1">
                        {/* Title row */}
                        <div className="flex flex-wrap items-center gap-2">
                          {!entry.unlocked ? (
                            <Lock size={13} className="shrink-0 text-amber-400" />
                          ) : null}
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
                          {isSelected ? (
                            <span className="rounded-full border border-st-accent/40 bg-st-accent/10 px-2 py-0.5 text-xs font-medium text-st-accent">
                              Active
                            </span>
                          ) : null}
                        </div>

                        {/* Chips row */}
                        <div className="mt-2 flex flex-wrap items-center gap-1.5">
                          <span className="rounded border border-st-border bg-st-bg/60 px-2 py-0.5 text-xs text-st-muted">
                            Level {entry.level}
                          </span>
                          <span className="rounded border border-st-border bg-st-bg/60 px-2 py-0.5 text-xs text-st-muted">
                            {entry.mapTier} map
                          </span>
                          <span className="rounded border border-st-border bg-st-bg/60 px-2 py-0.5 text-xs text-st-muted">
                            {entry.npcCount} NPC{entry.npcCount === 1 ? "" : "s"}
                          </span>
                          {entry.unlocked ? (
                            <span
                              className={cn(
                                "rounded border px-2 py-0.5 text-xs",
                                entry.winCount >= entry.requiredWins
                                  ? "border-emerald-500/30 bg-emerald-950/20 text-emerald-300"
                                  : "border-st-border bg-st-bg/60 text-st-muted",
                              )}
                            >
                              {entry.winCount}/{entry.requiredWins} wins required
                            </span>
                          ) : null}
                          {!entry.unlocked ? (
                            <span className="rounded border border-amber-500/30 bg-amber-950/20 px-2 py-0.5 text-xs text-amber-300">
                              Locked
                            </span>
                          ) : null}
                        </div>

                        <p className="mt-2.5 text-sm text-st-muted">{entry.description}</p>

                        {/* Inline stats */}
                        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-st-muted">
                          <span>
                            Turn{" "}
                            <span className="font-semibold text-st-fg">
                              {game?.currentTurn ?? 0}
                            </span>
                          </span>
                          <span>
                            Started{" "}
                            <span className="font-semibold text-st-fg">
                              {formatRelativeDateTime(game?.startedAt ?? null)}
                            </span>
                          </span>
                        </div>

                        {game !== null ? (
                          <Link
                            to={getGamePath(game)}
                            className="mt-1.5 inline-block text-xs text-cyan-400/60 hover:text-cyan-300"
                            onClick={(event) => {
                              event.stopPropagation();
                            }}
                          >
                            /game/{getGameRouteKey(game)}
                          </Link>
                        ) : null}

                        {/* Result inset */}
                        {game?.status === "finished" && result !== null ? (
                          <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 rounded-lg border border-st-border bg-st-bg/60 px-3 py-2 text-xs text-st-muted">
                            <span>
                              Place{" "}
                              <span className="font-semibold text-st-fg">
                                {result.auroraPlacement === null
                                  ? "—"
                                  : `#${result.auroraPlacement}`}
                              </span>
                            </span>
                            <span>
                              Winner{" "}
                              <span className="font-semibold text-st-fg">
                                {result.winnerEmpireName ?? "—"}
                              </span>
                            </span>
                            <span>
                              Finished{" "}
                              <span className="font-semibold text-st-fg">
                                {formatDateTime(result.endedAt)}
                              </span>
                            </span>
                            <span>
                              Reason{" "}
                              <span className="font-semibold text-st-fg">
                                {result.finishReason ?? "—"}
                              </span>
                            </span>
                          </div>
                        ) : null}

                        {game?.status === "finished" &&
                        result !== null &&
                        result.auroraPlacement !== null ? (
                          <p className="mt-2 text-xs text-st-muted">
                            {result.auroraStarsControlledFinal ?? 0} stars ·{" "}
                            {result.auroraFleetStrengthFinal ?? 0} fleet · score{" "}
                            {result.auroraScoreFinal ?? 0}
                          </p>
                        ) : null}

                        {!entry.unlocked ? (
                          <p className="mt-2 text-xs text-amber-300/70">
                            Complete prerequisite missions to unlock.
                          </p>
                        ) : null}
                      </div>

                      {/* ─ Action column ─ */}
                      <div className="flex shrink-0 items-center gap-2">
                        {game !== null &&
                        entry.isActiveMember &&
                        game.status === "running" ? (
                          <button
                            type="button"
                            className={cn(
                              "rounded-lg border px-3 py-2 text-sm font-medium transition-colors",
                              resignBusyScenarioKey === entry.key
                                ? "border-st-border bg-st-bg text-st-muted"
                                : "border-orange-500/40 bg-orange-500/10 text-orange-300 hover:bg-orange-500/20",
                            )}
                            disabled={
                              busyScenarioKey === entry.key ||
                              resignBusyScenarioKey === entry.key
                            }
                            onClick={(event) => {
                              event.stopPropagation();
                              void onScenarioResign(entry);
                            }}
                          >
                            {resignBusyScenarioKey === entry.key ? "Resigning..." : "Resign"}
                          </button>
                        ) : null}
                        <button
                          type="button"
                          className={cn(
                            "min-w-20 rounded-lg border px-5 py-2.5 text-sm font-semibold transition-colors",
                            entry.unlocked && entry.game !== null
                              ? "border-cyan-500/40 bg-cyan-500/10 text-cyan-300 hover:border-cyan-400/60 hover:bg-cyan-500/20"
                              : "border-st-border bg-st-bg text-st-muted",
                          )}
                          disabled={
                            !entry.unlocked ||
                            entry.game === null ||
                            busyScenarioKey === entry.key ||
                            resignBusyScenarioKey === entry.key
                          }
                          onClick={(event) => {
                            event.stopPropagation();
                            void onScenarioAction(entry);
                          }}
                        >
                          {busyScenarioKey === entry.key ? "Working..." : actionLabel(entry)}
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
          </div>
        )}
      </div>
    </div>
  );
}