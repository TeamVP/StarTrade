import { createBrowserRouter, RouterProvider } from "react-router-dom";
import { AuthenticatedGameLayout } from "@/app/router/AuthenticatedGameLayout";
import { GalaxyPage } from "@/app/router/GalaxyPage";
import { GamesPage } from "@/app/router/GamesPage";
import { FleetPage } from "@/app/router/FleetPage";
import { CombatPage } from "@/app/router/CombatPage";
import { EconomyPage } from "@/app/router/EconomyPage";
import { EmpiresPage } from "@/app/router/EmpiresPage";
import { TradersPage } from "@/app/router/TradersPage";
import { HistoryPage } from "@/app/router/HistoryPage";
import { BalancePage } from "@/app/router/BalancePage";
import { SignInPage } from "@/app/router/SignInPage";
import { PlayerGameLayout } from "@/app/router/PlayerGameLayout";
import { PlayerHomePage } from "@/app/router/PlayerHomePage";
import { PlayerLobbyPage } from "@/app/router/PlayerLobbyPage";
import { PlayerEmpirePage } from "@/app/router/PlayerEmpirePage";
import { PlayerEconomyPage } from "@/app/router/PlayerEconomyPage";
import { PlayerFleetPage } from "@/app/router/PlayerFleetPage";
import { PlayerCombatPage } from "@/app/router/PlayerCombatPage";
import { PlayerHistoryPage } from "@/app/router/PlayerHistoryPage";
import { PLAYER_PREVIEW_BY_PATH } from "@/features/player/playerPreviewConfig";

const playerChildRoutes = [
  { index: true, element: <PlayerHomePage /> },
  { path: "lobby", element: <PlayerLobbyPage /> },
  { path: "empire", element: <PlayerEmpirePage /> },
  { path: "economy", element: <PlayerEconomyPage /> },
  { path: "fleet", element: <PlayerFleetPage /> },
  { path: "combat", element: <PlayerCombatPage /> },
  { path: "history", element: <PlayerHistoryPage /> },
] as const;

const router = createBrowserRouter([
  {
    path: "/sign-in",
    element: <SignInPage />,
  },
  {
    path: "/eplayer1",
    element: <PlayerGameLayout config={PLAYER_PREVIEW_BY_PATH["/eplayer1"]} />,
    children: [...playerChildRoutes],
  },
  {
    path: "/eplayer2",
    element: <PlayerGameLayout config={PLAYER_PREVIEW_BY_PATH["/eplayer2"]} />,
    children: [...playerChildRoutes],
  },
  {
    path: "/",
    element: <AuthenticatedGameLayout />,
    children: [
      { index: true, element: <GalaxyPage /> },
      { path: "games", element: <GamesPage /> },
      { path: "fleet", element: <FleetPage /> },
      { path: "combat", element: <CombatPage /> },
      { path: "economy", element: <EconomyPage /> },
      { path: "empires", element: <EmpiresPage /> },
      { path: "traders", element: <TradersPage /> },
      { path: "history", element: <HistoryPage /> },
      { path: "balance", element: <BalancePage /> },
    ],
  },
]);

export function AppRouter() {
  return <RouterProvider router={router} />;
}
