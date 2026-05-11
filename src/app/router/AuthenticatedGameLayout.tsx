import { Navigate, Outlet } from "react-router-dom";
import { Authenticated, Unauthenticated } from "convex/react";
import { AppShell } from "@/app/layout/AppShell";
import { TopNav } from "@/app/layout/TopNav";
import { SignOutButton } from "@/features/usr/components/SignOutButton";
import { ActiveGameProvider } from "@/features/galaxy/context/ActiveGameContext";

export function AuthenticatedGameLayout() {
  return (
    <AppShell nav={<TopNav />} headerTrailing={<SignOutButton />}>
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
