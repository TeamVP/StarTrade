import { useQuery, Authenticated, Unauthenticated } from "convex/react";
import { Navigate, NavLink, Outlet } from "react-router-dom";
import { AppShell } from "@/app/layout/AppShell";
import { ActiveGameProvider } from "@/features/galaxy/context/ActiveGameContext";
import { api } from "../../../convex/_generated/api";
import { SignOutButton } from "@/features/usr/components/SignOutButton";
import { cn } from "@/lib/utils";

const links = [
  { to: "/lobby", label: "Lobby", end: true },
  { to: "/profile", label: "Profile", end: true },
] as const;

export function UserAreaLayout() {
  const account = useQuery(api.usr.queries.getMyAccount, {});

  return (
    <AppShell nav={<UserNav />} headerTrailing={<SignOutButton />}>
      <Authenticated>
        <ActiveGameProvider
          key={account?.user._id ?? "user-area"}
          storageKey={`starstrat:activeGameId:${account?.user._id ?? "user-area"}`}
        >
          <Outlet />
        </ActiveGameProvider>
      </Authenticated>
      <Unauthenticated>
        <Navigate to="/sign-in" replace />
      </Unauthenticated>
    </AppShell>
  );
}

function UserNav() {
  return (
    <nav className="flex flex-wrap gap-1 text-sm" aria-label="Account">
      {links.map(({ to, label, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          className={({ isActive }) =>
            cn(
              "rounded-md px-3 py-1.5 transition-colors",
              isActive
                ? "bg-st-accent text-slate-950"
                : "text-st-muted hover:bg-st-panel hover:text-st-fg",
            )
          }
        >
          {label}
        </NavLink>
      ))}
    </nav>
  );
}