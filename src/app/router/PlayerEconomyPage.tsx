import { Navigate } from "react-router-dom";
import { EconomyScreen } from "@/features/economy/components/EconomyScreen";
import { useActiveGame } from "@/features/galaxy/hooks/useActiveGame";
import { gameModeSupportsTraderGameplay } from "@/features/games/gameMode";
import { usePlayerPreview } from "@/features/player/PlayerPreviewContext";
import { usePlayerGameMembership } from "@/features/player/PlayerPreviewContext";

export function PlayerEconomyPage() {
  const membership = usePlayerGameMembership();
  const { activeGame } = useActiveGame();
  const { basePath } = usePlayerPreview();

  if (activeGame !== null && !gameModeSupportsTraderGameplay(activeGame.mode)) {
    return <Navigate to={basePath} replace />;
  }

  return (
    <EconomyScreen
      playerEmpireId={membership.empireId}
      playerActorId={membership.actorId}
      hideGamePicker
    />
  );
}
