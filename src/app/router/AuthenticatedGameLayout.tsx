import { Link, Navigate, Outlet } from "react-router-dom";
import { Authenticated, Unauthenticated } from "convex/react";
import { AppShell } from "@/app/layout/AppShell";
import { TopNav } from "@/app/layout/TopNav";
import { Button } from "@/components/ui/button";
import { ActiveGameProvider } from "@/features/galaxy/context/ActiveGameContext";

export function AuthenticatedGameLayout() {
  return (
    <AppShell
      nav={<TopNav />}
      headerTrailing={
        <Button variant="secondary" className="px-3 py-px text-xs" asChild>
          <Link to="/lobby">Back to Lobby</Link>
        </Button>
      }
    >
      <Authenticated>
        <ActiveGameProvider>
          <Outlet />
        </ActiveGameProvider>
      </Authenticated>
      <Unauthenticated>
        <Navigate to="/sign-in" replace />
      </Unauthenticated>
    </AppShell>
  );
}
