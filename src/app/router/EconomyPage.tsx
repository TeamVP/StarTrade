import { Navigate } from "react-router-dom";
import { EconomyScreen } from "@/features/economy/components/EconomyScreen";
import { useActiveGame } from "@/features/galaxy/hooks/useActiveGame";
import { gameModeSupportsTraderGameplay } from "@/features/games/gameMode";

export function EconomyPage() {
  const { activeGame } = useActiveGame();

  if (activeGame !== null && !gameModeSupportsTraderGameplay(activeGame.mode)) {
    return <Navigate to="/admin" replace />;
  }

  return <EconomyScreen />;
}
