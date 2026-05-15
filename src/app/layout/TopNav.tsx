import { NavLink } from "react-router-dom";
import { cn } from "@/lib/utils";

const links = [
  { to: "/admin", label: "Admin", end: true },
  { to: "/admin/map", label: "Map", end: false },
  { to: "/admin/games", label: "Games", end: false },
  { to: "/admin/fleet", label: "Fleet", end: false },
  { to: "/admin/combat", label: "Combat", end: false },
  { to: "/admin/economy", label: "Economy", end: false },
  { to: "/admin/empires", label: "Empires", end: false },
  { to: "/admin/traders", label: "Traders", end: false },
  { to: "/admin/history", label: "History", end: false },
  { to: "/admin/balance", label: "Balance", end: false },
  { to: "/admin/users", label: "Users", end: false },
] as const;

export function TopNav() {
  return (
    <nav className="flex flex-wrap gap-1 text-sm" aria-label="Main">
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
