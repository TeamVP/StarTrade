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

const router = createBrowserRouter([
  {
    path: "/sign-in",
    element: <SignInPage />,
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
