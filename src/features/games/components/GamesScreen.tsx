import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import type { Doc } from "../../../../convex/_generated/dataModel";
import { DEFAULT_TURN_DURATION_SECONDS } from "../../../../convex/sim/turnTiming";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AdminPanel } from "@/features/admin/components/AdminPanel";
import { useActiveGame } from "@/features/galaxy/hooks/useActiveGame";

/** Matches `TURN_RESOLUTION_STALE_MS` in convex/sim/internal.ts — cron may start a new job after this. */
const SERVER_STALE_RESOLVING_MS = 3 * 60_000;
/** Softer UI warning while cron has not yet reclaimed the turn. */
const RESOLVING_WARN_MS = 45_000;

function formatStartedAt(startedAt: number | null): string {
  if (startedAt === null) return "Not started";
  return new Date(startedAt).toLocaleString();
}

function formatDurationMs(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  return r === 0 ? `${m}m` : `${m}m ${r}s`;
}

function formatFinishReason(reason: string): string {
  return reason
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function TurnProgressCell(props: {
  now: number;
  turnState: "open" | "resolving" | "resolved" | null;
  resolutionPhase: string | null;
  resolvingStartedAt: number | null;
  turnPausedUntilMs: number | undefined;
  simCronTurnsDisabled: boolean | undefined;
}) {
  const {
    now,
    turnState,
    resolutionPhase,
    resolvingStartedAt,
    turnPausedUntilMs,
    simCronTurnsDisabled,
  } = props;

  const autopilotOff = simCronTurnsDisabled === true;

  let body: ReactNode;

  if (
    turnPausedUntilMs !== undefined &&
    turnPausedUntilMs > now
  ) {
    body = (
      <div className="text-st-muted">
        <span className="text-amber-200/90">Timer paused</span>
        <div className="mt-0.5 text-xs text-st-muted">
          until {new Date(turnPausedUntilMs).toLocaleTimeString()}
        </div>
      </div>
    );
  } else if (turnState === null) {
    body = <span className="text-amber-200/90">No turn row</span>;
  } else if (turnState === "open") {
    body = <span className="text-emerald-200/90">Open — waiting for tick</span>;
  } else if (turnState === "resolved") {
    body = (
      <span className="text-st-muted">Resolved (unexpected on current turn)</span>
    );
  } else {
    const phaseLabel = resolutionPhase ?? "…";
    if (resolvingStartedAt === null) {
      body = (
        <div>
          <span className="text-cyan-200/90">Resolving</span>
          <div className="mt-0.5 font-mono text-xs text-st-muted">{phaseLabel}</div>
        </div>
      );
    } else {
      const elapsed = now - resolvingStartedAt;
      const warn = elapsed >= RESOLVING_WARN_MS;
      const severe = elapsed >= SERVER_STALE_RESOLVING_MS;
      body = (
        <div>
          <div
            className={
              severe
                ? "font-medium text-red-300"
                : warn
                  ? "font-medium text-amber-200"
                  : "text-cyan-200/90"
            }
          >
            Resolving · {formatDurationMs(elapsed)}
          </div>
          <div className="mt-0.5 font-mono text-xs text-st-muted">{phaseLabel}</div>
          {warn ? (
            <div className="mt-1 text-xs text-st-muted">
              {severe
                ? "Cron should schedule a fresh resolver; use Retry if it stays stuck."
                : "If this sits here for several minutes, try Retry as admin."}
            </div>
          ) : null}
        </div>
      );
    }
  }

  return (
    <div>
      {autopilotOff ? (
        <div className="mb-1 text-xs font-medium text-amber-200/90">
          Autopilot suspended — cron will not advance this game
        </div>
      ) : null}
      {body}
    </div>
  );
}

export function GamesScreen() {
  const { activeGame, setSelectedGameId } = useActiveGame();
  const running = useQuery(api.sim.queries.listRunningGamesTurnProgress);
  const recentOfficialResults = useQuery(api.usr.queries.listRecentOfficialEmpireResults, {
    limit: 8,
  });
  const forceRetry = useMutation(api.admin.mutations.forceRetryTurnResolution);
  const setSimCronTurnsDisabled = useMutation(
    api.sim.mutations.setSimCronTurnsDisabled,
  );

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => {
      setNow(Date.now());
    }, 5000);
    return () => window.clearInterval(id);
  }, []);

  const runningRows = useMemo(() => running ?? [], [running]);

  const [retryBusyId, setRetryBusyId] = useState<string | null>(null);
  const [retryError, setRetryError] = useState<string | null>(null);
  const [cronBusyId, setCronBusyId] = useState<string | null>(null);
  const [cronError, setCronError] = useState<string | null>(null);

  async function onForceRetry(gameId: Doc<"sim_games">["_id"]) {
    setRetryBusyId(gameId);
    setRetryError(null);
    try {
      await forceRetry({ gameId });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setRetryError(message.replace(/^[\s\S]*?Error:\s*/g, "").trim());
    } finally {
      setRetryBusyId(null);
    }
  }

  async function onToggleCronAutopilot(
    gameId: Doc<"sim_games">["_id"],
    disable: boolean,
  ) {
    setCronBusyId(gameId);
    setCronError(null);
    try {
      await setSimCronTurnsDisabled({ gameId, disabled: disable });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setCronError(message.replace(/^[\s\S]*?Error:\s*/g, "").trim());
    } finally {
      setCronBusyId(null);
    }
  }

  return (
    <div className="space-y-4">
      <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-st-muted">
            Games
          </h2>
          <p className="mt-1 text-sm text-st-muted">
            Running games, turn resolution status, and Convex ids. Game admins can{" "}
            <strong className="font-medium text-st-fg">Suspend autopilot</strong> on a single game
            so the {DEFAULT_TURN_DURATION_SECONDS}s cron stops starting turns there (other running games keep going). Simulation
            data lives in Convex—restarting your local dev server does not reset these games.
          </p>
        </div>
        <div className="rounded-md border border-st-border bg-st-bg px-3 py-2 text-xs text-st-muted">
          {running === undefined ? "…" : runningRows.length} running
        </div>
      </div>

      {retryError !== null ? (
        <p className="mt-3 rounded-md border border-red-900/50 bg-red-950/30 px-3 py-2 text-sm text-red-200">
          {retryError}
        </p>
      ) : null}

      {cronError !== null ? (
        <p className="mt-3 rounded-md border border-red-900/50 bg-red-950/30 px-3 py-2 text-sm text-red-200">
          {cronError}
        </p>
      ) : null}

      <div className="mt-4 overflow-x-auto">
        {running === undefined ? (
          <p className="rounded-lg border border-st-border bg-st-bg px-3 py-4 text-sm text-st-muted">
            Loading games…
          </p>
        ) : runningRows.length === 0 ? (
          <p className="rounded-lg border border-st-border bg-st-bg px-3 py-4 text-sm text-st-muted">
            No games are currently running.
          </p>
        ) : (
          <table className="min-w-full border-separate border-spacing-0 text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-st-muted">
                <th className="border-b border-st-border px-3 py-2 font-medium">Name</th>
                <th className="border-b border-st-border px-3 py-2 font-medium">Game ID</th>
                <th className="border-b border-st-border px-3 py-2 font-medium">Map</th>
                <th className="border-b border-st-border px-3 py-2 font-medium">Turn</th>
                <th className="border-b border-st-border px-3 py-2 font-medium">
                  Autopilot
                </th>
                <th className="border-b border-st-border px-3 py-2 font-medium">
                  Turn progress
                </th>
                <th className="border-b border-st-border px-3 py-2 font-medium">Started</th>
                <th className="border-b border-st-border px-3 py-2 font-medium" />
              </tr>
            </thead>
            <tbody>
              {runningRows.map((game) => {
                const isActive = activeGame?._id === game.gameId;
                const cronOff = game.simCronTurnsDisabled === true;
                return (
                  <tr key={game.gameId} className="align-top">
                    <td className="border-b border-st-border/60 px-3 py-2">
                      <div className="font-medium text-st-fg">{game.name}</div>
                      {isActive ? (
                        <div className="mt-0.5 text-xs text-cyan-300">Active game</div>
                      ) : null}
                    </td>
                    <td className="border-b border-st-border/60 px-3 py-2">
                      <code className="break-all rounded bg-st-bg px-1.5 py-0.5 text-xs text-st-fg">
                        {game.gameId}
                      </code>
                    </td>
                    <td className="border-b border-st-border/60 px-3 py-2 font-mono text-xs text-st-fg">
                      {game.mapKey}
                    </td>
                    <td className="border-b border-st-border/60 px-3 py-2 text-st-fg">
                      {game.currentTurn}
                    </td>
                    <td className="border-b border-st-border/60 px-3 py-2 text-st-fg">
                      {game.viewerCanForceRetry ? (
                        <Button
                          type="button"
                          variant={cronOff ? "secondary" : "outline"}
                          className="whitespace-nowrap px-2 py-1 text-xs"
                          disabled={cronBusyId !== null}
                          onClick={() =>
                            void onToggleCronAutopilot(game.gameId, !cronOff)
                          }
                        >
                          {cronBusyId === game.gameId
                            ? "…"
                            : cronOff
                              ? "Enable autopilot"
                              : "Suspend autopilot"}
                        </Button>
                      ) : cronOff ? (
                        <span className="text-amber-200/90">Suspended</span>
                      ) : (
                        <span className="text-emerald-200/80">On</span>
                      )}
                    </td>
                    <td className="border-b border-st-border/60 px-3 py-2 text-st-fg">
                      <TurnProgressCell
                        now={now}
                        turnState={game.turnState}
                        resolutionPhase={game.resolutionPhase}
                        resolvingStartedAt={game.resolvingStartedAt}
                        turnPausedUntilMs={game.turnPausedUntilMs}
                        simCronTurnsDisabled={game.simCronTurnsDisabled}
                      />
                    </td>
                    <td className="border-b border-st-border/60 px-3 py-2 text-xs text-st-muted">
                      {formatStartedAt(game.gameStartedAt)}
                    </td>
                    <td className="border-b border-st-border/60 px-3 py-2 text-right">
                      <div className="flex flex-col items-end gap-1">
                        {game.viewerCanForceRetry &&
                        (game.turnState === "resolving" || game.turnState === "open") ? (
                          <Button
                            type="button"
                            variant="outline"
                            className="whitespace-nowrap px-2 py-1 text-xs"
                            disabled={retryBusyId !== null}
                            onClick={() => void onForceRetry(game.gameId)}
                          >
                            {retryBusyId === game.gameId ? "Retry…" : "Retry resolve"}
                          </Button>
                        ) : null}
                        <Button
                          type="button"
                          variant="secondary"
                          className="whitespace-nowrap px-2 py-1 text-xs"
                          disabled={isActive}
                          onClick={() => setSelectedGameId(game.gameId)}
                        >
                          {isActive ? "Selected" : "Select"}
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      </Card>

      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-st-muted">
              Recent Official Results
            </h2>
            <p className="mt-1 text-sm text-st-muted">
              Durable finished-game outcomes preserved after simulation cleanup.
            </p>
          </div>
          <div className="rounded-md border border-st-border bg-st-bg px-3 py-2 text-xs text-st-muted">
            {recentOfficialResults === undefined ? "…" : recentOfficialResults.length} results
          </div>
        </div>

        <div className="mt-4 grid gap-3">
          {recentOfficialResults === undefined ? (
            <p className="rounded-lg border border-st-border bg-st-bg px-3 py-4 text-sm text-st-muted">
              Loading recent official results…
            </p>
          ) : recentOfficialResults.length === 0 ? (
            <p className="rounded-lg border border-st-border bg-st-bg px-3 py-4 text-sm text-st-muted">
              No official finished results yet.
            </p>
          ) : (
            recentOfficialResults.map((result) => {
              const isActive = activeGame?._id === result.gameId;
              return (
                <div
                  key={`${result.gameId}:${result.endedAt}`}
                  className="flex flex-col gap-3 rounded-lg border border-st-border bg-st-bg px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="font-medium text-st-fg">{result.name}</div>
                      <span className="rounded-full border border-st-border px-2 py-0.5 text-xs font-medium text-st-muted">
                        {result.mapKey}
                      </span>
                      <span className="rounded-full border border-st-border px-2 py-0.5 text-xs font-medium text-st-muted">
                        {formatFinishReason(result.finishReason)}
                      </span>
                      {isActive ? (
                        <span className="rounded-full border border-st-accent/40 bg-st-accent/10 px-2 py-0.5 text-xs font-medium text-st-accent">
                          Selected
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-1 text-sm text-st-muted">
                      {result.winner === null
                        ? "No winner recorded"
                        : `${result.winner.empireName} won${result.winner.playerName !== null ? ` as ${result.winner.playerName}` : ""}`}
                    </p>
                    <p className="mt-1 text-xs text-st-muted">
                      Ended {new Date(result.endedAt).toLocaleString()} · Score{" "}
                      {result.winner?.scoreFinal ?? "-"} · Stars{" "}
                      {result.winner?.starsControlledFinal ?? "-"} · Fleet{" "}
                      {result.winner?.fleetStrengthFinal ?? "-"}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="secondary"
                    className="shrink-0 whitespace-nowrap"
                    disabled={isActive}
                    onClick={() => setSelectedGameId(result.gameId)}
                  >
                    {isActive ? "Selected" : "Select game"}
                  </Button>
                </div>
              );
            })
          )}
        </div>
      </Card>
      <AdminPanel />
    </div>
  );
}
