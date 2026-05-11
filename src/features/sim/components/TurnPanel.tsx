import { useState } from "react";
import { useMutation } from "convex/react";
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

  const [pauseBusy, setPauseBusy] = useState(false);
  const [killBusy, setKillBusy] = useState(false);

  const gameId = activeGame?._id;
  const canStart =
    activeGame !== null && activeGame.status === "lobby" && gameId !== undefined;
  const canStep =
    activeGame !== null && activeGame.status === "running" && gameId !== undefined;
  const canPauseOrResume =
    activeGame !== null &&
    (activeGame.status === "running" || activeGame.status === "paused") &&
    gameId !== undefined;

  async function onPauseToggle() {
    if (!gameId || activeGame === undefined) return;
    setPauseBusy(true);
    try {
      if (activeGame.status === "running") {
        await pauseGame({ gameId });
      } else if (activeGame.status === "paused") {
        await resumeGame({ gameId });
      }
    } finally {
      setPauseBusy(false);
    }
  }

  async function onKillGame() {
    if (!gameId) return;
    if (
      !window.confirm(
        "Permanently delete this game and all of its map and simulation data? This cannot be undone.",
      )
    ) {
      return;
    }
    setKillBusy(true);
    try {
      await killGame({ gameId });
    } finally {
      setKillBusy(false);
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
      </dl>
      <div className="mt-3 flex flex-col gap-2">
        <Button
          disabled={!canStart}
          variant="secondary"
          className="w-full"
          onClick={() => {
            if (!gameId) return;
            void startGame({ gameId });
          }}
        >
          Start game
        </Button>
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
        <Button
          disabled={!canStep}
          className="w-full"
          onClick={() => {
            if (!gameId) return;
            void stepTurn({ gameId });
          }}
        >
          Step turn
        </Button>
        {gameId !== undefined ? (
          <Button
            disabled={killBusy}
            variant="secondary"
            className="w-full border border-red-500/40 text-red-600 hover:border-red-500/70 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
            onClick={() => void onKillGame()}
          >
            {killBusy ? "Deleting…" : "Kill game"}
          </Button>
        ) : null}
      </div>
      <p className="mt-2 text-xs text-st-muted">
        Create a game, seed the map, start, issue fleet moves for the current turn, then step.
        Pause stops automatic turns and manual stepping until you play again. Kill removes the game
        entirely.
      </p>
    </Card>
  );
}
