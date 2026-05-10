import { NavLink } from "react-router-dom";
import { cn } from "@/lib/utils";

const links = [
  { to: "/", label: "Galaxy", end: true },
  { to: "/fleet", label: "Fleet", end: false },
  { to: "/combat", label: "Combat", end: false },
  { to: "/economy", label: "Economy", end: false },
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
