import { useQuery } from "convex/react";
import { Navigate, useParams } from "react-router-dom";
import { PlayerGameLayout } from "@/app/router/PlayerGameLayout";
import { api } from "../../../convex/_generated/api";

export function GameRoutePage() {
  const { gameId } = useParams();

  if (gameId === undefined || gameId.length === 0) {
    return <Navigate to="/lobby" replace />;
  }

  const resolvedGame = useQuery(api.sim.queries.resolveGameRoute, { routeKey: gameId });

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