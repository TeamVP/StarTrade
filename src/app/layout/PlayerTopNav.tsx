import { useState } from "react";
import { Link, NavLink } from "react-router-dom";
import { Menu, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { usePlayerTopNavControls } from "@/app/layout/PlayerTopNavControls";
import { usePlayerPreview } from "@/features/player/PlayerPreviewContext";
import { SignOutButton } from "@/features/usr/components/SignOutButton";

const subPaths = [
  { segment: "", label: "Map" },
  { segment: "economy", label: "Economy" },
  { segment: "fleet", label: "Fleet" },
  { segment: "combat", label: "Combat" },
  { segment: "history", label: "History" },
  { segment: "results", label: "Results" },
] as const;

export function PlayerTopNav() {
  const { basePath } = usePlayerPreview();
  const { controls } = usePlayerTopNavControls();
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
        <Button type="button" variant="secondary" className="px-3 py-px text-xs" asChild>
          <Link to="/lobby">Back to Lobby</Link>
        </Button>
        {subPaths.map(({ segment, label }) => (
          <Button key={segment || "map"} type="button" variant="secondary" className="px-3 py-px text-xs" asChild>
            <NavLink
              to={segment === "" ? basePath : `${basePath}/${segment}`}
              end={segment === ""}
              className={({ isActive }) =>
                cn(isActive ? "border-st-accent bg-st-accent/10 text-st-fg" : undefined)
              }
            >
              {label}
            </NavLink>
          </Button>
        ))}
      </nav>

      {/* Mobile header strip — visible only on small screens */}
      <div className="flex w-full items-center justify-between gap-2 sm:hidden">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            className="rounded-md p-1.5 text-st-muted transition-colors hover:bg-st-panel hover:text-st-fg"
            aria-label="Open navigation menu"
          >
            <Menu size={20} />
          </button>
          <Link
            to="/"
            className="rounded-md px-2 py-px text-base font-semibold tracking-wide text-st-fg transition-colors hover:bg-st-panel"
          >
            StarStrat
          </Link>
        </div>
        <div className="flex items-center gap-1">
          {controls.sound ?? null}
          {controls.panel ?? null}
        </div>
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
              to="/lobby"
              onClick={() => setDrawerOpen(false)}
              className="rounded-md px-3 py-2 text-st-muted transition-colors hover:bg-st-panel hover:text-st-fg"
            >
              Back to Lobby
            </Link>

            {subPaths.map(({ segment, label }) => (
              <NavLink
                key={segment || "map"}
                to={segment === "" ? basePath : `${basePath}/${segment}`}
                end={segment === ""}
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

            <div className="mt-2 border-t border-st-border pt-3 flex flex-col gap-1">
              <NavLink
                to="/profile"
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
                Profile
              </NavLink>
              <NavLink
                to="/strat"
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
                Strat
              </NavLink>
              <div className="px-1 pt-1">
                <SignOutButton />
              </div>
            </div>
          </nav>
        </div>
      )}
    </>
  );
}
