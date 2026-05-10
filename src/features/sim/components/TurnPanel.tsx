import { useMutation } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useGalaxyData } from "@/features/galaxy/hooks/useGalaxyData";

export function TurnPanel() {
  const { activeGame } = useGalaxyData();
  const startGame = useMutation(api.sim.mutations.startGame);
  const stepTurn = useMutation(api.sim.mutations.stepTurn);

  const gameId = activeGame?._id;
  const canStart =
    activeGame !== null && activeGame.status === "lobby" && gameId !== undefined;
  const canStep =
    activeGame !== null && activeGame.status === "running" && gameId !== undefined;

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
      </div>
      <p className="mt-2 text-xs text-st-muted">
        Create a game, seed the map, start, issue fleet moves for the current turn, then step.
      </p>
    </Card>
  );
}
