import { useState } from "react";
import { Link, NavLink } from "react-router-dom";
import { Menu, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { usePlayerPreview } from "@/features/player/PlayerPreviewContext";

const subPaths = [
  { segment: "lobby", label: "Lobby" },
  { segment: "empire", label: "Empire" },
  { segment: "economy", label: "Economy" },
  { segment: "fleet", label: "Fleet" },
  { segment: "combat", label: "Combat" },
  { segment: "history", label: "History" },
  { segment: "results", label: "Results" },
] as const;

export function PlayerTopNav() {
  const { basePath } = usePlayerPreview();
  const [drawerOpen, setDrawerOpen] = useState(false);

  return (
    <>
      {/* Desktop nav — hidden on small screens */}
      <nav
        className="hidden sm:flex flex-wrap items-center gap-1 text-sm leading-none"
        aria-label="Player home"
      >
        <Link
          to="/"
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

      {/* Mobile header strip — visible only on small screens */}
      <div className="flex sm:hidden items-center gap-2">
        <Link
          to="/"
          className="rounded-md px-2 py-px text-base font-semibold tracking-wide text-st-fg transition-colors hover:bg-st-panel"
        >
          StarStrat
        </Link>
        <button
          type="button"
          onClick={() => setDrawerOpen(true)}
          className="rounded-md p-1.5 text-st-muted transition-colors hover:bg-st-panel hover:text-st-fg"
          aria-label="Open navigation menu"
        >
          <Menu size={20} />
        </button>
      </div>

      {/* Mobile slide-out drawer */}
      {drawerOpen && (
        <div
          className="fixed inset-0 z-50 flex"
          onClick={() => setDrawerOpen(false)}
        >
          {/* Backdrop */}
          <div className="absolute inset-0 bg-black/60" />

          {/* Drawer panel */}
          <nav
            className="relative z-10 flex w-64 flex-col gap-1 border-r border-st-border bg-st-bg p-4 text-sm"
            onClick={(e) => e.stopPropagation()}
            aria-label="Player navigation"
          >
            <div className="mb-3 flex items-center justify-between">
              <Link
                to="/"
                onClick={() => setDrawerOpen(false)}
                className="text-base font-semibold tracking-wide text-st-fg"
              >
                StarStrat
              </Link>
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                className="rounded-md p-1 text-st-muted transition-colors hover:bg-st-panel hover:text-st-fg"
                aria-label="Close menu"
              >
                <X size={18} />
              </button>
            </div>

            <Link
              to="/"
              onClick={() => setDrawerOpen(false)}
              className="rounded-md px-3 py-2 text-st-muted transition-colors hover:bg-st-panel hover:text-st-fg"
            >
              ← Back to Games
            </Link>

            {subPaths.map(({ segment, label }) => (
              <NavLink
                key={segment}
                to={`${basePath}/${segment}`}
                onClick={() => setDrawerOpen(false)}
                className={({ isActive }) =>
                  cn(
                    "rounded-md px-3 py-2 transition-colors",
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
        </div>
      )}
    </>
  );
}
