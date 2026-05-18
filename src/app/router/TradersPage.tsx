import { Navigate } from "react-router-dom";
import { TraderScreen } from "@/features/traders/components/TraderScreen";
import { useActiveGame } from "@/features/galaxy/hooks/useActiveGame";
import { gameModeSupportsTraderGameplay } from "@/features/games/gameMode";

export function TradersPage() {
  const { activeGame } = useActiveGame();

  if (activeGame !== null && !gameModeSupportsTraderGameplay(activeGame.mode)) {
    return <Navigate to="/admin" replace />;
  }

  return <TraderScreen />;
}
