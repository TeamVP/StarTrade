import { useQuery } from "convex/react";
import { Link, Navigate, useParams } from "react-router-dom";
import { PlayerGameLayout } from "@/app/router/PlayerGameLayout";
import { api } from "../../../convex/_generated/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

function formatFinishReason(reason: string): string {
  return reason
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function GameRoutePage() {
  const { gameId } = useParams();

  if (gameId === undefined || gameId.length === 0) {
    return <Navigate to="/lobby" replace />;
  }

  const resolvedGame = useQuery(api.sim.queries.resolveGameRoute, { routeKey: gameId });
  const durableResult = useQuery(
    api.sim.queries.getDurableGameResult,
    resolvedGame !== null && resolvedGame !== undefined && resolvedGame.status === "finished"
      ? { gameId: resolvedGame.gameId }
      : "skip",
  );

  if (resolvedGame === undefined) {
    return null;
  }

  if (resolvedGame === null) {
    return <Navigate to="/lobby" replace />;
  }

  const canonicalRouteKey = resolvedGame.urlCode ?? resolvedGame.gameId;
  if (canonicalRouteKey !== gameId) {
    return <Navigate to={`/game/${canonicalRouteKey}`} replace />;
  }

  if (resolvedGame.status === "finished") {
    const finishReason = durableResult?.gameResult.finishReason ?? null;
    const endedAt = durableResult?.gameResult.endedAt ?? resolvedGame.endedAt ?? null;
    const winner = durableResult?.placements.find((row) => row.isWinner) ?? null;
    const liveSimulationRemoved =
      resolvedGame.finalizationState === "pending_cleanup" ||
      resolvedGame.finalizationState === "cleaned";

    return (
      <div className="flex min-h-dvh items-center justify-center bg-st-bg px-4 py-8 text-st-fg">
        <Card className="w-full max-w-xl p-6">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-st-muted">
            Finished game
          </p>
          <h1 className="mt-3 text-2xl font-semibold text-st-fg">{resolvedGame.name}</h1>
          <p className="mt-3 text-sm text-st-muted">
            {liveSimulationRemoved
              ? "This game has already finished and its live simulation has been cleaned up."
              : "This game has already finished."} Return to the lobby to start or join another game.
          </p>
          <dl className="mt-5 grid grid-cols-1 gap-3 text-sm text-st-muted sm:grid-cols-2">
            <div>
              <dt className="text-xs uppercase tracking-wide">Status</dt>
              <dd className="mt-1 text-st-fg">Finished</dd>
            </div>
            {finishReason !== null ? (
              <div>
                <dt className="text-xs uppercase tracking-wide">Finish reason</dt>
                <dd className="mt-1 text-st-fg">{formatFinishReason(finishReason)}</dd>
              </div>
            ) : null}
            {endedAt !== null ? (
              <div>
                <dt className="text-xs uppercase tracking-wide">Ended</dt>
                <dd className="mt-1 text-st-fg">{new Date(endedAt).toLocaleString()}</dd>
              </div>
            ) : null}
            {winner !== null ? (
              <div>
                <dt className="text-xs uppercase tracking-wide">Winner</dt>
                <dd className="mt-1 text-st-fg">{winner.empireName}</dd>
              </div>
            ) : null}
          </dl>
          <div className="mt-6 flex flex-wrap gap-3">
            <Button asChild>
              <Link to="/lobby" replace>
                Return to lobby
              </Link>
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <PlayerGameLayout
      config={{
        basePath: `/game/${canonicalRouteKey}`,
        empireName: null,
        resolveMembershipFromActiveGame: true,
        spectatorLabel: "Spectator",
      }}
      initialSelectedGameId={resolvedGame.gameId}
    />
  );
}