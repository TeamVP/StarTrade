import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useGalaxyData } from "@/features/galaxy/hooks/useGalaxyData";

export function TurnPanel() {
  const { activeGame } = useGalaxyData();
  const startGame = useMutation(api.sim.mutations.startGame);
  const stepTurn = useMutation(api.sim.mutations.stepTurn);
  const pauseGame = useMutation(api.sim.mutations.pauseGame);
  const resumeGame = useMutation(api.sim.mutations.resumeGame);
  const killGame = useMutation(api.admin.mutations.killGame);

  const [startBusy, setStartBusy] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [pauseBusy, setPauseBusy] = useState(false);
  const [killBusy, setKillBusy] = useState(false);
  const [killError, setKillError] = useState<string | null>(null);
  const [stepBusy, setStepBusy] = useState(false);
  const [stepError, setStepError] = useState<string | null>(null);
  const [pauseError, setPauseError] = useState<string | null>(null);

  const gameId = activeGame?._id;
  const myRoles = useQuery(
    api.usr.queries.listMyRoles,
    gameId !== undefined ? { gameId } : "skip",
  );
  const timeline = useQuery(
    api.sim.queries.getTurnTimelineForGame,
    gameId !== undefined ? { gameId } : "skip",
  );
  const turnResolving = timeline?.turnState === "resolving";
  const isGameAdmin = myRoles?.some((role) => role.role === "admin") ?? false;
  const canPauseOrResumeClock =
    myRoles?.some((role) => role.role === "admin" || role.role === "empire") ??
    false;
  const canStart =
    activeGame !== null && activeGame.status === "lobby" && gameId !== undefined;
  const canStep =
    activeGame !== null &&
    activeGame.status === "running" &&
    gameId !== undefined &&
    !turnResolving;
  const canPauseOrResume =
    activeGame !== null &&
    (activeGame.status === "running" || activeGame.status === "paused") &&
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
        {turnResolving ? (
          <>
            <dt className="text-st-muted">Resolution</dt>
            <dd className="text-right capitalize">
              {timeline?.resolutionPhase ?? "working"}
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
          {turnResolving ? "Resolving turn..." : stepBusy ? "Queuing..." : "Step turn"}
        </Button>
        {stepError !== null ? (
          <p className="text-xs text-red-600 dark:text-red-400" role="alert">
            {stepError}
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
      <p className="mt-2 text-xs text-st-muted">
        Create a game, seed the map, start, issue fleet moves for the current turn, then step.
        Pause freezes the match clock for everyone; admins and empire players can pause or resume.
        Admins can suspend autopilot on the Games page so only that game stops auto-resolving. Game
        admins can kill a game to remove it entirely.
      </p>
    </Card>
  );
}
