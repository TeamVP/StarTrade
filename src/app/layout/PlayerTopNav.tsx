import { Link, NavLink } from "react-router-dom";
import { cn } from "@/lib/utils";
import { usePlayerPreview } from "@/features/player/PlayerPreviewContext";

const subPaths = [
  { segment: "lobby", label: "Lobby" },
  { segment: "empire", label: "Empire" },
  { segment: "economy", label: "Economy" },
  { segment: "fleet", label: "Fleet" },
  { segment: "combat", label: "Combat" },
  { segment: "history", label: "History" },
] as const;

export function PlayerTopNav() {
  const { basePath } = usePlayerPreview();

  return (
    <nav className="flex flex-wrap items-center gap-1 text-sm leading-none" aria-label="Player home">
      <Link
        to={basePath}
        className="rounded-md px-3 py-px text-base font-semibold tracking-wide text-st-fg transition-colors hover:bg-st-panel"
      >
        StarStrat
      </Link>
      <Link
        to="/"
        className="rounded-md px-3 py-px text-st-muted transition-colors hover:bg-st-panel hover:text-st-fg"
      >
        &lt; Back
      </Link>
      {subPaths.map(({ segment, label }) => (
        <NavLink
          key={segment}
          to={`${basePath}/${segment}`}
          className={({ isActive }) =>
            cn(
              "rounded-md px-3 py-px transition-colors",
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
