import { Navigate, createBrowserRouter, RouterProvider } from "react-router-dom";
import { lazy, Suspense, type ComponentType } from "react";
import { PLAYER_PREVIEW_BY_PATH } from "@/features/player/playerPreviewConfig";

function lazyNamedComponent<TProps>(
  loader: () => Promise<Record<string, ComponentType<TProps>>>,
  exportName: string,
) {
  return lazy(async () => {
    const module = await loader();
    const Component = module[exportName];

    if (!Component) {
      throw new Error(`Failed to load lazy route component: ${exportName}`);
    }

    return { default: Component };
  });
}

const AuthenticatedGameLayout = lazyNamedComponent(
  () => import("@/app/router/AuthenticatedGameLayout"),
  "AuthenticatedGameLayout",
);
const LandingPage = lazyNamedComponent(() => import("@/app/router/LandingPage"), "LandingPage");
const GalaxyPage = lazyNamedComponent(() => import("@/app/router/GalaxyPage"), "GalaxyPage");
const GamesPage = lazyNamedComponent(() => import("@/app/router/GamesPage"), "GamesPage");
const FleetPage = lazyNamedComponent(() => import("@/app/router/FleetPage"), "FleetPage");
const CombatPage = lazyNamedComponent(() => import("@/app/router/CombatPage"), "CombatPage");
const EconomyPage = lazyNamedComponent(() => import("@/app/router/EconomyPage"), "EconomyPage");
const EmpiresPage = lazyNamedComponent(() => import("@/app/router/EmpiresPage"), "EmpiresPage");
const TradersPage = lazyNamedComponent(() => import("@/app/router/TradersPage"), "TradersPage");
const HistoryPage = lazyNamedComponent(() => import("@/app/router/HistoryPage"), "HistoryPage");
const BalancePage = lazyNamedComponent(() => import("@/app/router/BalancePage"), "BalancePage");
const SignInPage = lazyNamedComponent(() => import("@/app/router/SignInPage"), "SignInPage");
const PrivacyPolicyPage = lazyNamedComponent(
  () => import("@/app/router/PrivacyPolicyPage"),
  "PrivacyPolicyPage",
);
const TermsOfServicePage = lazyNamedComponent(
  () => import("@/app/router/TermsOfServicePage"),
  "TermsOfServicePage",
);
const PlayerGameLayout = lazyNamedComponent(
  () => import("@/app/router/PlayerGameLayout"),
  "PlayerGameLayout",
);
const PlayerHomePage = lazyNamedComponent(
  () => import("@/app/router/PlayerHomePage"),
  "PlayerHomePage",
);
const PlayerLobbyPage = lazyNamedComponent(
  () => import("@/app/router/PlayerLobbyPage"),
  "PlayerLobbyPage",
);
const PlayerEmpirePage = lazyNamedComponent(
  () => import("@/app/router/PlayerEmpirePage"),
  "PlayerEmpirePage",
);
const PlayerEconomyPage = lazyNamedComponent(
  () => import("@/app/router/PlayerEconomyPage"),
  "PlayerEconomyPage",
);
const PlayerFleetPage = lazyNamedComponent(
  () => import("@/app/router/PlayerFleetPage"),
  "PlayerFleetPage",
);
const PlayerCombatPage = lazyNamedComponent(
  () => import("@/app/router/PlayerCombatPage"),
  "PlayerCombatPage",
);
const PlayerHistoryPage = lazyNamedComponent(
  () => import("@/app/router/PlayerHistoryPage"),
  "PlayerHistoryPage",
);

const playerChildRoutes = [
  { index: true, element: <PlayerHomePage /> },
  { path: "lobby", element: <PlayerLobbyPage /> },
  { path: "empire", element: <PlayerEmpirePage /> },
  { path: "economy", element: <PlayerEconomyPage /> },
  { path: "fleet", element: <PlayerFleetPage /> },
  { path: "combat", element: <PlayerCombatPage /> },
  { path: "history", element: <PlayerHistoryPage /> },
] as const;

const adminChildRoutes = [
  { index: true, element: <GalaxyPage /> },
  { path: "games", element: <GamesPage /> },
  { path: "fleet", element: <FleetPage /> },
  { path: "combat", element: <CombatPage /> },
  { path: "economy", element: <EconomyPage /> },
  { path: "empires", element: <EmpiresPage /> },
  { path: "traders", element: <TradersPage /> },
  { path: "history", element: <HistoryPage /> },
  { path: "balance", element: <BalancePage /> },
] as const;

const legacyAdminRedirects = [
  { path: "/games", to: "/admin/games" },
  { path: "/fleet", to: "/admin/fleet" },
  { path: "/combat", to: "/admin/combat" },
  { path: "/economy", to: "/admin/economy" },
  { path: "/empires", to: "/admin/empires" },
  { path: "/traders", to: "/admin/traders" },
  { path: "/history", to: "/admin/history" },
  { path: "/balance", to: "/admin/balance" },
] as const;

const router = createBrowserRouter([
  {
    path: "/",
    element: <LandingPage />,
  },
  {
    path: "/sign-in",
    element: <SignInPage />,
  },
  {
    path: "/legals/privacy",
    element: <PrivacyPolicyPage />,
  },
  {
    path: "/legals/tos",
    element: <TermsOfServicePage />,
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
    path: "/admin",
    element: <AuthenticatedGameLayout />,
    children: [...adminChildRoutes],
  },
  {
    path: "/",
    children: legacyAdminRedirects.map(({ path, to }) => ({
      path,
      element: <Navigate to={to} replace />,
    })),
  },
]);

export function AppRouter() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-dvh items-center justify-center bg-st-bg text-sm text-st-muted">
          Loading...
        </div>
      }
    >
      <RouterProvider router={router} />
    </Suspense>
  );
}
