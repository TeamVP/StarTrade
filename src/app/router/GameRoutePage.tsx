import { Navigate, useParams } from "react-router-dom";
import { PlayerGameLayout } from "@/app/router/PlayerGameLayout";
import { AURORA_COMBINE_EMPIRE_NAME } from "@/features/player/playerPreviewConfig";
import type { Id } from "../../../convex/_generated/dataModel";

export function GameRoutePage() {
  const { gameId } = useParams();

  if (gameId === undefined || gameId.length === 0) {
    return <Navigate to="/lobby" replace />;
  }

  return (
    <PlayerGameLayout
      config={{ basePath: `/game/${gameId}`, empireName: AURORA_COMBINE_EMPIRE_NAME }}
      initialSelectedGameId={gameId as Id<"sim_games">}
    />
  );
}