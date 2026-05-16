import { NavLink } from "react-router-dom";
import { useQuery } from "convex/react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { api } from "../../../../convex/_generated/api";

const links = [
  { to: "/profile", label: "Profile" },
  { to: "/strat", label: "Strat" },
] as const;

export function UserHeaderActions() {
  const account = useQuery(api.usr.queries.getMyAccount, {});

  return (
    <>
      {links.map(({ to, label }) => (
        <Button key={to} type="button" variant="secondary" className="px-3 py-px text-xs" asChild>
          <NavLink
            to={to}
            className={({ isActive }) =>
              cn(isActive ? "border-st-accent bg-st-accent/10 text-st-fg" : undefined)
            }
          >
            {label}
          </NavLink>
        </Button>
      ))}
      {account?.user.admin ? (
        <Button type="button" variant="secondary" className="px-3 py-px text-xs" asChild>
          <NavLink
            to="/admin"
            className={({ isActive }) =>
              cn(isActive ? "border-st-accent bg-st-accent/10 text-st-fg" : undefined)
            }
          >
            Admin
          </NavLink>
        </Button>
      ) : null}
    </>
  );
}
