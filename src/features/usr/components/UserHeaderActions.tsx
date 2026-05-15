import { NavLink } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { SignOutButton } from "@/features/usr/components/SignOutButton";
import { cn } from "@/lib/utils";

const links = [
  { to: "/profile", label: "Profile" },
  { to: "/strat", label: "Strat" },
] as const;

export function UserHeaderActions() {
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
      <SignOutButton />
    </>
  );
}