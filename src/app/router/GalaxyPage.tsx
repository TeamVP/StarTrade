import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { ChevronRight, ChevronLeft } from "lucide-react";
import { usePlayerTopNavControlSetter } from "@/app/layout/PlayerTopNavControls";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { GalaxyViewport } from "@/features/galaxy/components/GalaxyViewport";
import { GalaxyMapNavProvider } from "@/features/galaxy/context/GalaxyMapNavContext";
import { EmpirePanel } from "@/features/empire/components/EmpirePanel";
import { ReplayPanel } from "@/features/replay/components/ReplayPanel";
import { TurnPanel } from "@/features/sim/components/TurnPanel";

function focusFleetIdFromState(state: unknown): string | null {
  if (state === null || typeof state !== "object") return null;
  const value = (state as { focusFleetId?: unknown }).focusFleetId;
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function GalaxyPage() {
  const location = useLocation();
  const focusFleetId = focusFleetIdFromState(location.state);
  const [showPanel, setShowPanel] = useState(false);
  const setMobileControl = usePlayerTopNavControlSetter();

  useEffect(() => {
    setMobileControl(
      "panel",
      <Button
        type="button"
        variant="secondary"
        className="h-8 gap-1 px-2 text-xs sm:hidden"
        onClick={() => setShowPanel((open) => !open)}
      >
        {showPanel ? <ChevronLeft className="size-3.5" aria-hidden /> : null}
        {showPanel ? "Back to map" : "Info"}
        {!showPanel ? <ChevronRight className="size-3.5" aria-hidden /> : null}
      </Button>,
    );

    return () => {
      setMobileControl("panel", null);
    };
  }, [setMobileControl, showPanel]);

  return (
    <GalaxyMapNavProvider>
      {/*
       * Single layout tree — GalaxyViewport rendered once.
       * Desktop (lg+): two-column grid, aside is a static grid item.
       * Mobile (<lg): one-column, aside is a fixed overlay that slides in from the right.
       */}
      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        {/* Map pane */}
        <section className="relative space-y-4">
          <GalaxyViewport initialFocusFleetId={focusFleetId} />
        </section>

        {/*
         * Info panel.
         * Mobile: fixed overlay, slides in from right edge.
         * Desktop: static grid item (all fixed/translate overrides cleared at lg+).
         */}
        <aside
          className={cn(
            // Mobile: fixed slide-in from right
            "fixed inset-y-0 right-0 z-50 w-full max-w-sm overflow-y-auto border-l border-st-border bg-st-bg p-4 shadow-2xl transition-transform duration-300 ease-in-out",
            // Desktop: plain static grid column
            "lg:static lg:inset-auto lg:z-auto lg:max-w-none lg:border-0 lg:bg-transparent lg:p-0 lg:shadow-none lg:translate-x-0",
            // Mobile visibility toggle (lg always stays at translate-x-0)
            showPanel ? "translate-x-0" : "translate-x-full lg:translate-x-0",
          )}
        >
          {/* Mobile-only "Back to map" button at top of panel */}
          <button
            type="button"
            onClick={() => setShowPanel(false)}
            className="mb-4 flex items-center gap-1 rounded-md bg-st-panel px-3 py-1.5 text-sm text-st-fg lg:hidden"
            aria-label="Back to map"
          >
            <ChevronLeft size={14} /> Back to map
          </button>

          <div className="space-y-4">
            <TurnPanel />
            <EmpirePanel />
            <ReplayPanel />
          </div>
        </aside>
      </div>

      {/* Mobile backdrop — closes the panel when tapped */}
      {showPanel && (
        <div
          className="fixed inset-0 z-40 bg-black/60 lg:hidden"
          onClick={() => setShowPanel(false)}
          aria-hidden="true"
        />
      )}
    </GalaxyMapNavProvider>
  );
}
