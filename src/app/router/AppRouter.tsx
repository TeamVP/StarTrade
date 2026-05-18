import { Navigate, createBrowserRouter, RouterProvider } from "react-router-dom";
import { lazy, Suspense, type ComponentType } from "react";
import { AppRouteErrorPage } from "@/app/router/AppRouteErrorPage";

function lazyNamedComponent<TProps>(
  loader: () => Promise<Record<string, ComponentType<TProps>>>,
  exportName: string,
) {
  return lazy(async () => {
    try {
      const module = await loader();
      const Component = module[exportName];

      if (!Component) {
        throw new Error(`Failed to load lazy route component: ${exportName}`);
      }

      return { default: Component };
    } catch (error) {
      // When a new deploy replaces hashed chunks the browser still holds the
      // old URL and the server returns an HTML 404 instead of JS, producing a
      // MIME-type / fetch error.  Force a one-shot hard reload so the user
      // transparently picks up the new bundle instead of seeing a crash.
      const errorMessage = error instanceof Error ? error.message : String(error);
      const isChunkError =
        error instanceof TypeError &&
        (errorMessage.includes("Failed to fetch dynamically imported module") ||
          errorMessage.includes("Importing a module script failed") ||
          errorMessage.includes("Failed to load module script") ||
          errorMessage.includes("Expected a JavaScript-or-Wasm module script"));
      if (isChunkError) {
        const RELOAD_KEY = `chunk_reload_${exportName}`;
        if (!sessionStorage.getItem(RELOAD_KEY)) {
          sessionStorage.setItem(RELOAD_KEY, "1");
          window.location.reload();
          // Return a never-resolving promise; the reload will happen before it
          // would need to settle.
          return new Promise<never>(() => undefined);
        }
      }
      throw error;
    }
  });
}

const AuthenticatedGameLayout = lazyNamedComponent(
  () => import("@/app/router/AuthenticatedGameLayout"),
  "AuthenticatedGameLayout",
);
const AdminGuard = lazyNamedComponent(
  () => import("@/app/router/AdminGuard"),
  "AdminGuard",
);
const LandingPage = lazyNamedComponent(() => import("@/app/router/LandingPage"), "LandingPage");
const GalaxyPage = lazyNamedComponent(() => import("@/app/router/GalaxyPage"), "GalaxyPage");
const AdminHomePage = lazyNamedComponent(
  () => import("@/app/router/AdminHomePage"),
  "AdminHomePage",
);
const AdminUsersPage = lazyNamedComponent(
  () => import("@/app/router/AdminUsersPage"),
  "AdminUsersPage",
);
const AdminDatabasePage = lazyNamedComponent(
  () => import("@/app/router/AdminDatabasePage"),
  "AdminDatabasePage",
);
const AdminSettingsPage = lazyNamedComponent(
  () => import("@/app/router/AdminSettingsPage"),
  "AdminSettingsPage",
);
const AdminModerationPage = lazyNamedComponent(
  () => import("@/app/router/AdminModerationPage"),
  "AdminModerationPage",
);
const AdminStrategiesPage = lazyNamedComponent(
  () => import("@/app/router/AdminStrategiesPage"),
  "AdminStrategiesPage",
);
const AdminEmpireNpcsPage = lazyNamedComponent(
  () => import("@/app/router/AdminEmpireNpcsPage"),
  "AdminEmpireNpcsPage",
);
const AdminMissionsPage = lazyNamedComponent(
  () => import("@/app/router/AdminMissionsPage"),
  "AdminMissionsPage",
);
const AdminTraderNpcsPage = lazyNamedComponent(
  () => import("@/app/router/AdminTraderNpcsPage"),
  "AdminTraderNpcsPage",
);
const GamesPage = lazyNamedComponent(() => import("@/app/router/GamesPage"), "GamesPage");
const FleetPage = lazyNamedComponent(() => import("@/app/router/FleetPage"), "FleetPage");
const CombatPage = lazyNamedComponent(() => import("@/app/router/CombatPage"), "CombatPage");
const EconomyPage = lazyNamedComponent(() => import("@/app/router/EconomyPage"), "EconomyPage");
const EmpiresPage = lazyNamedComponent(() => import("@/app/router/EmpiresPage"), "EmpiresPage");
const TradersPage = lazyNamedComponent(() => import("@/app/router/TradersPage"), "TradersPage");
const HistoryPage = lazyNamedComponent(() => import("@/app/router/HistoryPage"), "HistoryPage");
const ResultsPage = lazyNamedComponent(() => import("@/app/router/ResultsPage"), "ResultsPage");
const BalancePage = lazyNamedComponent(() => import("@/app/router/BalancePage"), "BalancePage");
const SignInPage = lazyNamedComponent(() => import("@/app/router/SignInPage"), "SignInPage");
const UserAreaLayout = lazyNamedComponent(
  () => import("@/app/router/UserAreaLayout"),
  "UserAreaLayout",
);
const LobbyPage = lazyNamedComponent(() => import("@/app/router/LobbyPage"), "LobbyPage");
const ProfilePage = lazyNamedComponent(() => import("@/app/router/ProfilePage"), "ProfilePage");
const PublisherPage = lazyNamedComponent(() => import("@/app/router/PublisherPage"), "PublisherPage");
const StratPage = lazyNamedComponent(() => import("@/app/router/StratPage"), "StratPage");
const PrivacyPolicyPage = lazyNamedComponent(
  () => import("@/app/router/PrivacyPolicyPage"),
  "PrivacyPolicyPage",
);
const TermsOfServicePage = lazyNamedComponent(
  () => import("@/app/router/TermsOfServicePage"),
  "TermsOfServicePage",
);
const PlayerHomePage = lazyNamedComponent(
  () => import("@/app/router/PlayerHomePage"),
  "PlayerHomePage",
);
const PlayerLobbyPage = lazyNamedComponent(
  () => import("@/app/router/PlayerLobbyPage"),
  "PlayerLobbyPage",
);
const GameRoutePage = lazyNamedComponent(
  () => import("@/app/router/GameRoutePage"),
  "GameRoutePage",
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
const PlayerResultsPage = lazyNamedComponent(
  () => import("@/app/router/PlayerResultsPage"),
  "PlayerResultsPage",
);

const playerChildRoutes = [
  { index: true, element: <PlayerHomePage /> },
  { path: "lobby", element: <PlayerLobbyPage /> },
  { path: "empire", element: <PlayerEmpirePage /> },
  { path: "economy", element: <PlayerEconomyPage /> },
  { path: "fleet", element: <PlayerFleetPage /> },
  { path: "combat", element: <PlayerCombatPage /> },
  { path: "history", element: <PlayerHistoryPage /> },
  { path: "results", element: <PlayerResultsPage /> },
] as const;

const adminChildRoutes = [
  { index: true, element: <AdminHomePage /> },
  { path: "map", element: <GalaxyPage /> },
  { path: "games", element: <GamesPage /> },
  { path: "fleet", element: <FleetPage /> },
  { path: "combat", element: <CombatPage /> },
  { path: "economy", element: <EconomyPage /> },
  { path: "empires", element: <EmpiresPage /> },
  { path: "traders", element: <TradersPage /> },
  { path: "history", element: <HistoryPage /> },
  { path: "results", element: <ResultsPage /> },
  { path: "db", element: <AdminDatabasePage /> },
  { path: "settings", element: <AdminSettingsPage /> },
  { path: "moderation", element: <AdminModerationPage /> },
  { path: "strategies", element: <AdminStrategiesPage /> },
  { path: "mission", element: <AdminMissionsPage /> },
  { path: "empire-npcs", element: <AdminEmpireNpcsPage /> },
  { path: "trader-npcs", element: <AdminTraderNpcsPage /> },
  { path: "balance", element: <BalancePage /> },
  { path: "users", element: <AdminUsersPage /> },
] as const;

const legacyAdminRedirects = [
  { path: "/games", to: "/admin/games" },
  { path: "/fleet", to: "/admin/fleet" },
  { path: "/combat", to: "/admin/combat" },
  { path: "/economy", to: "/admin/economy" },
  { path: "/empires", to: "/admin/empires" },
  { path: "/traders", to: "/admin/traders" },
  { path: "/history", to: "/admin/history" },
  { path: "/results", to: "/admin/results" },
  { path: "/balance", to: "/admin/balance" },
] as const;

const routeErrorElement = <AppRouteErrorPage />;

const router = createBrowserRouter([
  {
    path: "/",
    element: <LandingPage />,
    errorElement: routeErrorElement,
  },
  {
    path: "/sign-in",
    element: <SignInPage />,
    errorElement: routeErrorElement,
  },
  {
    path: "/lobby",
    element: <UserAreaLayout />,
    errorElement: routeErrorElement,
    children: [{ index: true, element: <LobbyPage /> }],
  },
  {
    path: "/profile",
    element: <UserAreaLayout />,
    errorElement: routeErrorElement,
    children: [{ index: true, element: <ProfilePage /> }],
  },
  {
    path: "/publisher",
    element: <UserAreaLayout />,
    errorElement: routeErrorElement,
    children: [{ index: true, element: <PublisherPage /> }],
  },
  {
    path: "/strat",
    element: <UserAreaLayout />,
    errorElement: routeErrorElement,
    children: [{ index: true, element: <StratPage /> }],
  },
  {
    path: "/legals/privacy",
    element: <PrivacyPolicyPage />,
    errorElement: routeErrorElement,
  },
  {
    path: "/legals/tos",
    element: <TermsOfServicePage />,
    errorElement: routeErrorElement,
  },
  {
    path: "/game/:gameId",
    element: <GameRoutePage />,
    errorElement: routeErrorElement,
    children: [...playerChildRoutes],
  },
  {
    path: "/admin",
    element: <AuthenticatedGameLayout />,
    errorElement: routeErrorElement,
    children: [
      {
        element: <AdminGuard />,
        children: [...adminChildRoutes],
      },
    ],
  },
  {
    path: "/",
    errorElement: routeErrorElement,
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
