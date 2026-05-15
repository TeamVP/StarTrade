import { useLocation } from "react-router-dom";
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
  return (
    <GalaxyMapNavProvider>
      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        <section className="space-y-4">
          <GalaxyViewport initialFocusFleetId={focusFleetId} />
        </section>
        <aside className="space-y-4">
          <TurnPanel />
          <EmpirePanel />
          <ReplayPanel />
        </aside>
      </div>
    </GalaxyMapNavProvider>
  );
}
