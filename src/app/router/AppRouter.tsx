import { createBrowserRouter, RouterProvider } from "react-router-dom";
import { AuthenticatedGameLayout } from "@/app/router/AuthenticatedGameLayout";
import { GalaxyPage } from "@/app/router/GalaxyPage";
import { FleetPage } from "@/app/router/FleetPage";
import { CombatPage } from "@/app/router/CombatPage";
import { EconomyPage } from "@/app/router/EconomyPage";
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
      { path: "fleet", element: <FleetPage /> },
      { path: "combat", element: <CombatPage /> },
      { path: "economy", element: <EconomyPage /> },
    ],
  },
]);

export function AppRouter() {
  return <RouterProvider router={router} />;
}
