import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { DEFAULT_TURN_DURATION_MS } from "../../../../convex/sim/turnTiming";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useGalaxyData } from "@/features/galaxy/hooks/useGalaxyData";
import {
  formatMsAsClock,
  getTurnElapsedFraction,
} from "@/lib/time/turnClock";
import { useTurnClock } from "@/lib/time/useTurnClock";

export function TurnPanel() {
  const { activeGame } = useGalaxyData();
  const startGame = useMutation(api.sim.mutations.startGame);
  const stepTurn = useMutation(api.sim.mutations.stepTurn);
  const rebuildStandingOrders = useMutation(api.sim.mutations.rebuildStandingOrders);
  const scheduleNextTurnResolutionDelay = useMutation(
    api.sim.mutations.scheduleNextTurnResolutionDelay,
  );
  const pauseGame = useMutation(api.sim.mutations.pauseGame);
  const resumeGame = useMutation(api.sim.mutations.resumeGame);
  const killGame = useMutation(api.admin.mutations.killGame);
  const finalizeGameByScore = useMutation(api.admin.gameFinalization.finalizeGameByScore);
  const setGameRetentionClass = useMutation(api.admin.gameFinalization.setGameRetentionClass);
  const resignFromGame = useMutation(api.usr.mutations.resignFromGame);

  const [startBusy, setStartBusy] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [pauseBusy, setPauseBusy] = useState(false);
  const [killBusy, setKillBusy] = useState(false);
  const [killError, setKillError] = useState<string | null>(null);
  const [finalizeBusy, setFinalizeBusy] = useState(false);
  const [finalizeError, setFinalizeError] = useState<string | null>(null);
  const [retentionBusy, setRetentionBusy] = useState(false);
  const [retentionError, setRetentionError] = useState<string | null>(null);
  const [resignBusy, setResignBusy] = useState(false);
  const [resignError, setResignError] = useState<string | null>(null);
  const [stepBusy, setStepBusy] = useState(false);
  const [stepError, setStepError] = useState<string | null>(null);
  const [rebuildModalOpen, setRebuildModalOpen] = useState(false);
  const [rebuildPendingMode, setRebuildPendingMode] = useState<
    "rebuildCurrent" | "buildBlank" | "rebuildAll" | null
  >(null);
  const [rebuildModalError, setRebuildModalError] = useState<string | null>(null);
  /** Second step inside the modal for full wipe (replaces blocking `window.confirm`). */
  const [rebuildAllAwaitingInModalConfirm, setRebuildAllAwaitingInModalConfirm] = useState(false);
  const [pauseError, setPauseError] = useState<string | null>(null);
  const [scheduleBusy, setScheduleBusy] = useState(false);
  const [scheduleError, setScheduleError] = useState<string | null>(null);
  const planBarRef = useRef<HTMLDivElement | null>(null);

  const gameId = activeGame?._id;
  const myRoles = useQuery(
    api.usr.queries.listMyRoles,
    gameId !== undefined ? { gameId } : "skip",
  );
  const timeline = useQuery(
    api.sim.queries.getTurnTimelineForGame,
    gameId !== undefined ? { gameId } : "skip",
  );
  const durableResult = useQuery(
    api.sim.queries.getDurableGameResult,
    gameId !== undefined && activeGame?.status === "finished" ? { gameId } : "skip",
  );
  const turnBusy =
    timeline?.turnState !== undefined &&
    timeline.turnState !== null &&
    timeline.turnState !== "open";
  const turnGameStatus = timeline?.gameStatus ?? activeGame?.status ?? null;
  const { alignedNowMs, effectiveNowMs } = useTurnClock({
    gameStatus: turnGameStatus,
    turnPausedAtMs: timeline?.turnPausedAtMs ?? null,
    serverNowMs: timeline?.serverNowMs,
    tickMs: 200,
  });
  const canRebuildModalActions = !turnBusy && rebuildPendingMode === null;
  const isGameAdmin = myRoles?.some((role) => role.role === "admin") ?? false;
  const canResign = (myRoles?.length ?? 0) > 0 && gameId !== undefined;
  const canPauseOrResumeClock =
    myRoles?.some((role) => role.role === "admin" || role.role === "empire") ??
    false;
  const canStart =
    activeGame !== null && activeGame.status === "lobby" && gameId !== undefined;
  const canStep =
    activeGame !== null &&
    activeGame.status === "running" &&
    gameId !== undefined &&
    !turnBusy;
  const canRebuildOrders =
    activeGame !== null &&
    (activeGame.status === "running" || activeGame.status === "paused") &&
    gameId !== undefined &&
    !turnBusy;
  const canScheduleNextTurnDelay =
    activeGame !== null &&
    (activeGame.status === "running" || activeGame.status === "paused") &&
    gameId !== undefined &&
    !turnBusy;
  const canPauseOrResume =
    activeGame !== null &&
    ((activeGame.status === "running" && !turnBusy) ||
      activeGame.status === "paused") &&
    gameId !== undefined &&
    canPauseOrResumeClock;

  async function onStartGame() {
    if (!gameId) return;
    setStartBusy(true);
    setStartError(null);
    try {
      await startGame({ gameId });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStartError(message.replace(/^[\s\S]*?Error:\s*/g, "").trim());
    } finally {
      setStartBusy(false);
    }
  }

  async function onPauseToggle() {
    if (!gameId || activeGame === undefined) return;
    setPauseBusy(true);
    setPauseError(null);
    try {
      if (activeGame.status === "running") {
        await pauseGame({ gameId });
      } else if (activeGame.status === "paused") {
        await resumeGame({ gameId });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setPauseError(message.replace(/^[\s\S]*?Error:\s*/g, "").trim());
    } finally {
      setPauseBusy(false);
    }
  }

  async function onKillGame() {
    if (!gameId) return;
    if (!isGameAdmin) {
      setKillError("Only game admins can delete this game.");
      return;
    }
    if (
      !window.confirm(
        "Permanently delete this game and all of its map and simulation data? This cannot be undone.",
      )
    ) {
      return;
    }
    setKillBusy(true);
    setKillError(null);
    try {
      await killGame({ gameId });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setKillError(message.replace(/^[\s\S]*?Error:\s*/g, "").trim());
    } finally {
      setKillBusy(false);
    }
  }

  async function onFinalizeGameByScore() {
    if (!gameId) return;
    if (!isGameAdmin) {
      setFinalizeError("Only game admins can score-finalize this game.");
      return;
    }
    if (
      !window.confirm(
        "Finalize this game immediately using current standings and write durable results before cleanup?",
      )
    ) {
      return;
    }
    setFinalizeBusy(true);
    setFinalizeError(null);
    try {
      await finalizeGameByScore({ gameId });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setFinalizeError(message.replace(/^[\s\S]*?Error:\s*/g, "").trim());
    } finally {
      setFinalizeBusy(false);
    }
  }

  async function onRetentionClassChange(
    retentionClass: "discarded" | "official" | "archived_debug",
  ) {
    if (!gameId || !isGameAdmin) return;
    setRetentionBusy(true);
    setRetentionError(null);
    try {
      await setGameRetentionClass({ gameId, retentionClass });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setRetentionError(message.replace(/^[\s\S]*?Error:\s*/g, "").trim());
    } finally {
      setRetentionBusy(false);
    }
  }

  async function onResignFromGame() {
    if (!gameId) return;
    if (
      !window.confirm(
        "Resign from this game? If you are the last human participant, the game will end immediately, save final results, and begin cleanup.",
      )
    ) {
      return;
    }
    setResignBusy(true);
    setResignError(null);
    try {
      await resignFromGame({ gameId });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setResignError(message.replace(/^[\s\S]*?Error:\s*/g, "").trim());
    } finally {
      setResignBusy(false);
    }
  }

  async function onStepTurn() {
    if (!gameId) return;
    setStepBusy(true);
    setStepError(null);
    try {
      await stepTurn({ gameId });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStepError(message.replace(/^[\s\S]*?Error:\s*/g, "").trim());
    } finally {
      setStepBusy(false);
    }
  }

  function openRebuildOrdersModal() {
    setRebuildModalError(null);
    setRebuildAllAwaitingInModalConfirm(false);
    setRebuildModalOpen(true);
  }

  async function runRebuildOrdersMode(
    mode: "rebuildCurrent" | "buildBlank" | "rebuildAll",
  ) {
    if (!gameId) return;
    if (turnBusy) {
      setRebuildModalError(
        "This match is preparing or committing a turn. Try again when the current turn is open for orders.",
      );
      return;
    }
    setRebuildPendingMode(mode);
    setRebuildModalError(null);
    try {
      await rebuildStandingOrders({ gameId, mode });
      setRebuildModalOpen(false);
      setRebuildAllAwaitingInModalConfirm(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setRebuildModalError(message.replace(/^[\s\S]*?Error:\s*/g, "").trim());
    } finally {
      setRebuildPendingMode(null);
    }
  }

  const turnOpen = timeline?.turnState === "open";
  const planDurationMs = Math.max(1, timeline?.turnDurationMs ?? DEFAULT_TURN_DURATION_MS);
  const planStartedAt = timeline?.turnStartedAt ?? null;
  const nowMs = effectiveNowMs;
  const planElapsedFrac =
    turnOpen
      ? getTurnElapsedFraction({
          turnStartedAtMs: planStartedAt,
          turnDurationMs: planDurationMs,
          nowMs: alignedNowMs,
          gameStatus: turnGameStatus,
          turnPausedAtMs: timeline?.turnPausedAtMs ?? null,
        }) ?? 0
      : 0;
  const pauseUntilMs = timeline?.turnPausedUntilMs;
  const pauseRemainingMs =
    pauseUntilMs !== undefined && pauseUntilMs > nowMs
      ? Math.ceil(pauseUntilMs - nowMs)
      : 0;
  const pendingDelayRatio = timeline?.nextTurnAutoResolveDelayRatio;

  useEffect(() => {
    if (!rebuildModalOpen || !turnBusy) return;
    const id = window.setTimeout(() => {
      setRebuildAllAwaitingInModalConfirm(false);
      setRebuildModalError(
        "This match started preparing or committing a turn. Wait until that finishes, then try again if you still need to change standing orders.",
      );
    }, 0);
    return () => window.clearTimeout(id);
  }, [rebuildModalOpen, turnBusy]);

  const onPlanningBarPointer = useCallback(
    async (clientX: number) => {
      if (!gameId || !canScheduleNextTurnDelay || scheduleBusy) return;
      const el = planBarRef.current;
      if (el === null) return;
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0) return;
      const x = clientX - rect.left;
      const ratio = Math.max(0, Math.min(1, x / rect.width));
      setScheduleBusy(true);
      setScheduleError(null);
      try {
        await scheduleNextTurnResolutionDelay({ gameId, delayRatio: ratio });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setScheduleError(message.replace(/^[\s\S]*?Error:\s*/g, "").trim());
      } finally {
        setScheduleBusy(false);
      }
    },
    [
      gameId,
      canScheduleNextTurnDelay,
      scheduleBusy,
      scheduleNextTurnResolutionDelay,
    ],
  );

  async function clearScheduleDelay() {
    if (!gameId || !canScheduleNextTurnDelay || scheduleBusy) return;
    setScheduleBusy(true);
    setScheduleError(null);
    try {
      await scheduleNextTurnResolutionDelay({ gameId, delayRatio: 0 });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setScheduleError(message.replace(/^[\s\S]*?Error:\s*/g, "").trim());
    } finally {
      setScheduleBusy(false);
    }
  }

  return (
    <Card>
      <h2 className="text-sm font-semibold uppercase tracking-wide text-st-muted">
        Turn loop
      </h2>
      <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
        <dt className="text-st-muted">Status</dt>
        <dd className="text-right capitalize">{activeGame?.status ?? "—"}</dd>
        <dt className="text-st-muted">Current turn</dt>
        <dd className="text-right">{activeGame?.currentTurn ?? "—"}</dd>
        <dt className="text-st-muted">Retention</dt>
        <dd className="text-right capitalize">{activeGame?.retentionClass ?? "official"}</dd>
        {turnBusy ? (
          <>
            <dt className="text-st-muted">Turn work</dt>
            <dd className="text-right capitalize">
              {timeline?.turnState === "prepared"
                ? "Prepared"
                : timeline?.resolutionPhase ?? timeline?.turnState ?? "working"}
            </dd>
          </>
        ) : null}
        {timeline?.simCronTurnsDisabled ? (
          <>
            <dt className="text-st-muted">Autopilot</dt>
            <dd className="text-right text-amber-600 dark:text-amber-400">
              Suspended (cron)
            </dd>
          </>
        ) : null}
      </dl>
      {gameId !== undefined && isGameAdmin ? (
        <div className="mt-3">
          <label className="block text-xs font-semibold uppercase tracking-wide text-st-muted">
            Retention policy
          </label>
          <select
            className="mt-1 w-full rounded border border-st-border bg-st-bg px-3 py-2 text-sm"
            value={activeGame?.retentionClass ?? "official"}
            disabled={retentionBusy || activeGame?.finalizationState === "pending_cleanup"}
            onChange={(event) => {
              const value = event.target.value;
              if (
                value === "discarded" ||
                value === "official" ||
                value === "archived_debug"
              ) {
                void onRetentionClassChange(value);
              }
            }}
          >
            <option value="official">Official results</option>
            <option value="discarded">Discard after cleanup</option>
            <option value="archived_debug">Archived debug</option>
          </select>
          {retentionError !== null ? (
            <p className="mt-1 text-xs text-red-600 dark:text-red-400" role="alert">
              {retentionError}
            </p>
          ) : null}
        </div>
      ) : null}
      {activeGame?.status === "finished" && durableResult !== undefined && durableResult !== null ? (
        <div className="mt-4 rounded-lg border border-st-border bg-st-bg/60 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-st-muted">
                Durable result
              </p>
              <p className="mt-1 text-sm text-st-fg">
                {durableResult.gameResult.finishReason.replace(/_/g, " ")}
              </p>
            </div>
            <div className="text-right text-xs text-st-muted">
              <div>Finalization: {activeGame.finalizationState ?? "none"}</div>
              <div>Ended: {new Date(durableResult.gameResult.endedAt).toLocaleString()}</div>
            </div>
          </div>
          <div className="mt-3 space-y-2">
            {durableResult.placements.slice(0, 5).map((row) => {
              let strategyPreview: string | null = null;
              if (row.strategySummaryJson !== null) {
                try {
                  const parsed = JSON.parse(row.strategySummaryJson) as Record<string, unknown>;
                  strategyPreview = typeof parsed.summary === "string" ? parsed.summary : null;
                } catch {
                  strategyPreview = null;
                }
              }
              return (
                <div
                  key={`${row.placement}:${row.empireKey}`}
                  className="flex flex-wrap items-center justify-between gap-2 rounded border border-st-border/70 px-3 py-2 text-sm"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded bg-st-border/40 px-1.5 py-0.5 text-xs font-mono text-st-muted">
                        #{row.placement}
                      </span>
                      <span className="font-medium text-st-fg">{row.empireName}</span>
                      <span className="text-xs text-st-muted">
                        {row.controllerKind === "human"
                          ? row.playerName ?? "Human"
                          : row.playerName ?? row.npcPlayerKey ?? "NPC"}
                      </span>
                      {row.isWinner ? (
                        <span className="rounded-full border border-emerald-500/40 bg-emerald-950/30 px-2 py-0.5 text-xs font-medium text-emerald-200">
                          Winner
                        </span>
                      ) : null}
                    </div>
                    {strategyPreview !== null ? (
                      <p className="mt-1 text-xs text-st-muted">Strategy: {strategyPreview}</p>
                    ) : null}
                  </div>
                  <div className="text-right text-xs text-st-muted">
                    <div>{row.starsControlledFinal} stars</div>
                    <div>{row.fleetStrengthFinal} fleet strength</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
      {gameId !== undefined &&
      activeGame !== null &&
      (activeGame.status === "running" || activeGame.status === "paused") ? (
        <div className="mt-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-st-muted">
            Planning window
          </div>
          <p className="mt-1 text-xs text-st-muted">
            Click where this turn should end on the next turn&apos;s timer: after the current turn
            resolves, the match waits that far into the following turn before resolution may start
            (autopilot cron and manual Step both wait).
          </p>
          <div
            ref={planBarRef}
            role="presentation"
            className={`relative mt-2 h-3 w-full cursor-pointer overflow-hidden rounded-full border border-st-border bg-st-bg/80 ${
              !canScheduleNextTurnDelay || scheduleBusy ? "pointer-events-none opacity-50" : ""
            }`}
            onClick={(e) => {
              void onPlanningBarPointer(e.clientX);
            }}
            title="Click to schedule when the next turn may resolve"
          >
            <div
              className="absolute inset-y-0 left-0 bg-sky-600/70 dark:bg-sky-500/60"
              style={{ width: `${Math.round(planElapsedFrac * 100)}%` }}
            />
            {pendingDelayRatio !== undefined &&
            pendingDelayRatio !== null &&
            Number.isFinite(pendingDelayRatio) ? (
              <div
                className="pointer-events-none absolute inset-y-0 w-px bg-amber-400 shadow-[0_0_6px_rgba(251,191,36,0.9)]"
                style={{ left: `${Math.round(Math.max(0, Math.min(1, pendingDelayRatio)) * 100)}%` }}
              />
            ) : null}
          </div>
          <div className="mt-1 flex flex-wrap items-center justify-between gap-2 text-[11px] text-st-muted">
            <span>
              {turnOpen && planStartedAt !== null ? (
                <>
                  Elapsed {formatMsAsClock(planElapsedFrac * planDurationMs)} /{" "}
                  {formatMsAsClock(planDurationMs)}
                </>
              ) : turnBusy ? (
                "Turn busy — bar updates next open turn"
              ) : (
                "Open a turn to see the timer"
              )}
            </span>
            {pauseRemainingMs > 0 ? (
              <span className="text-amber-600 dark:text-amber-400">
                Resolution hold {formatMsAsClock(pauseRemainingMs)} left
              </span>
            ) : null}
          </div>
          <button
            type="button"
            className="mt-1 text-[11px] text-st-muted underline hover:text-st-fg disabled:opacity-40"
            disabled={!canScheduleNextTurnDelay || scheduleBusy || pendingDelayRatio === undefined}
            onClick={() => void clearScheduleDelay()}
          >
            Clear scheduled delay
          </button>
          {scheduleError !== null ? (
            <p className="mt-1 text-xs text-red-600 dark:text-red-400" role="alert">
              {scheduleError}
            </p>
          ) : null}
        </div>
      ) : null}
      <div className="mt-3 flex flex-col gap-2">
        <Button
          disabled={!canStart || startBusy}
          variant="secondary"
          className="w-full"
          onClick={() => void onStartGame()}
        >
          {startBusy ? "Starting..." : "Start game"}
        </Button>
        {startError !== null ? (
          <p className="text-xs text-red-600 dark:text-red-400" role="alert">
            {startError}
          </p>
        ) : null}
        {activeGame !== null &&
        (activeGame.status === "running" || activeGame.status === "paused") &&
        gameId !== undefined &&
        !canPauseOrResumeClock ? (
          <p className="text-xs text-st-muted" role="note">
            Pause and resume are available to game admins and empire players.
          </p>
        ) : null}
        {canPauseOrResume ? (
          <Button
            disabled={pauseBusy}
            variant="secondary"
            className="w-full"
            onClick={() => void onPauseToggle()}
          >
            {pauseBusy
              ? "Updating…"
              : activeGame?.status === "paused"
                ? "Play game"
                : "Pause game"}
          </Button>
        ) : null}
        {pauseError !== null ? (
          <p className="text-xs text-red-600 dark:text-red-400" role="alert">
            {pauseError}
          </p>
        ) : null}
        <Button
          disabled={!canStep || stepBusy}
          className="w-full"
          onClick={() => void onStepTurn()}
        >
          {turnBusy ? "Turn busy..." : stepBusy ? "Queuing..." : "Step turn"}
        </Button>
        {stepError !== null ? (
          <p className="text-xs text-red-600 dark:text-red-400" role="alert">
            {stepError}
          </p>
        ) : null}
        <Button
          disabled={!canRebuildOrders || rebuildPendingMode !== null}
          variant="secondary"
          className="w-full"
          type="button"
          onClick={() => openRebuildOrdersModal()}
        >
          Rebuild orders
        </Button>
        {gameId !== undefined && isGameAdmin ? (
          <Button
            disabled={finalizeBusy || activeGame?.finalizationState === "pending_cleanup"}
            variant="secondary"
            className="w-full border border-amber-500/40 text-amber-700 hover:border-amber-500/70 hover:text-amber-800 dark:text-amber-300 dark:hover:text-amber-200"
            onClick={() => void onFinalizeGameByScore()}
          >
            {finalizeBusy ? "Finalizing…" : "Finalize by score"}
          </Button>
        ) : null}
        {finalizeError !== null ? (
          <p className="text-xs text-red-600 dark:text-red-400" role="alert">
            {finalizeError}
          </p>
        ) : null}
        {canResign ? (
          <Button
            disabled={resignBusy || activeGame?.finalizationState === "pending_cleanup"}
            variant="secondary"
            className="w-full border border-orange-500/40 text-orange-700 hover:border-orange-500/70 hover:text-orange-800 dark:text-orange-300 dark:hover:text-orange-200"
            onClick={() => void onResignFromGame()}
          >
            {resignBusy ? "Resigning…" : "Resign from game"}
          </Button>
        ) : null}
        {resignError !== null ? (
          <p className="text-xs text-red-600 dark:text-red-400" role="alert">
            {resignError}
          </p>
        ) : null}
        {gameId !== undefined && isGameAdmin ? (
          <Button
            disabled={killBusy}
            variant="secondary"
            className="w-full border border-red-500/40 text-red-600 hover:border-red-500/70 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
            onClick={() => void onKillGame()}
          >
            {killBusy ? "Deleting…" : "Kill game"}
          </Button>
        ) : null}
        {killError !== null ? (
          <p className="text-xs text-red-600 dark:text-red-400" role="alert">
            {killError}
          </p>
        ) : null}
      </div>
      {rebuildModalOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          role="presentation"
          onClick={() => {
            if (!rebuildPendingMode) {
              setRebuildAllAwaitingInModalConfirm(false);
              setRebuildModalOpen(false);
            }
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="rebuild-orders-title"
            className="pointer-events-auto max-h-[min(90vh,520px)] w-full max-w-md overflow-y-auto rounded-xl border border-st-border bg-st-bg p-4 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3
              id="rebuild-orders-title"
              className="text-base font-semibold text-st-fg"
            >
              Rebuild standing orders
            </h3>
            <p className="mt-2 text-sm text-st-muted">
              Choose how to refresh garrison standing orders for this game. Empire automation must
              have a strategy loaded to repopulate automation routes.
            </p>
            <div className="mt-4 flex flex-col gap-2">
              <Button
                type="button"
                className="w-full"
                disabled={!canRebuildModalActions}
                onClick={() => void runRebuildOrdersMode("rebuildCurrent")}
              >
                {rebuildPendingMode === "rebuildCurrent" ? "Working…" : "Rebuild current orders"}
              </Button>
              <p className="text-xs text-st-muted">
                Removes automation-managed routes only, then replans them from each empire&apos;s
                strategy (manual standing orders stay).
              </p>
              <Button
                type="button"
                variant="secondary"
                className="w-full"
                disabled={!canRebuildModalActions}
                onClick={() => void runRebuildOrdersMode("buildBlank")}
              >
                {rebuildPendingMode === "buildBlank" ? "Working…" : "Build all blank"}
              </Button>
              <p className="text-xs text-st-muted">
                At every owned star that has no standing order yet, adds a default hop to a linked
                owned neighbor (25% dispatch, manual route) where such a link exists.
              </p>
              {!rebuildAllAwaitingInModalConfirm ? (
                <>
                  <Button
                    type="button"
                    variant="secondary"
                    className="w-full border border-amber-500/40 text-amber-800 hover:bg-amber-500/10 dark:text-amber-200"
                    disabled={!canRebuildModalActions}
                    onClick={() => {
                      setRebuildModalError(null);
                      setRebuildAllAwaitingInModalConfirm(true);
                    }}
                  >
                    Rebuild all…
                  </Button>
                  <p className="text-xs text-st-muted">
                    Deletes <strong className="text-st-fg">all</strong> standing orders (player and
                    automation), then runs automation planning so only strategy-backed routes return.
                  </p>
                </>
              ) : (
                <div className="rounded-lg border border-amber-500/50 bg-amber-500/10 p-3 dark:bg-amber-950/40">
                  <p className="text-sm font-medium text-amber-950 dark:text-amber-100">
                    Remove every standing order in this game (player and automation), then recreate
                    only what automation would use now?
                  </p>
                  <p className="mt-2 text-xs text-st-muted">This cannot be undone.</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="secondary"
                      className="flex-1"
                      disabled={!canRebuildModalActions}
                      onClick={() => {
                        setRebuildAllAwaitingInModalConfirm(false);
                        setRebuildModalError(null);
                      }}
                    >
                      Go back
                    </Button>
                    <Button
                      type="button"
                      className="min-w-40 flex-1 border border-amber-600/60 bg-amber-600 text-white hover:bg-amber-700 dark:border-amber-500/50"
                      disabled={!canRebuildModalActions}
                      onClick={() => void runRebuildOrdersMode("rebuildAll")}
                    >
                      {rebuildPendingMode === "rebuildAll" ? "Working…" : "Yes, delete and replan"}
                    </Button>
                  </div>
                </div>
              )}
            </div>
            {rebuildModalError !== null ? (
              <p className="mt-3 text-xs text-red-600 dark:text-red-400" role="alert">
                {rebuildModalError}
              </p>
            ) : null}
            <div className="mt-4 flex justify-end gap-2">
              <Button
                type="button"
                variant="secondary"
                disabled={rebuildPendingMode !== null}
                onClick={() => {
                  setRebuildAllAwaitingInModalConfirm(false);
                  setRebuildModalOpen(false);
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        </div>
      ) : null}
      <p className="mt-2 text-xs text-st-muted">
        Create a game, seed the map, start, issue fleet moves for the current turn, then step.
        Pause freezes the match clock for everyone; admins and empire players can pause or resume.
        Admins can suspend autopilot on the Games page so only that game stops auto-resolving.
        Resigning drops you from the game; if that leaves no human players, the match is score-finalized
        and cleaned up automatically. Game admins can kill a game to remove it entirely. Use <strong className="text-st-fg">Rebuild orders</strong>{" "}
        to refresh standing routes (see the dialog for current-only, fill-blank, or full reset plus
        automation replan). The planning bar schedules when the <em>following</em> turn may begin
        resolving; click near the left for soon, near the right for later in that turn&apos;s window.
      </p>
    </Card>
  );
}
