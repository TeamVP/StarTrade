import { Card } from "@/components/ui/card";
import { GalaxyViewport } from "@/features/galaxy/components/GalaxyViewport";
import { GalaxyMapNavProvider } from "@/features/galaxy/context/GalaxyMapNavContext";
import { EmpirePanel } from "@/features/empire/components/EmpirePanel";
import { usePlayerEmpireId, usePlayerPreview } from "@/features/player/PlayerPreviewContext";

export function PlayerHomePage() {
  const { empireName } = usePlayerPreview();
  const empireId = usePlayerEmpireId();

  const aside =
    empireId !== null ? (
      <EmpirePanel focusEmpireId={empireId} />
    ) : (
      <Card className="p-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-st-muted">
          Empire Snapshot
        </h2>
        <p className="mt-3 text-sm text-st-muted">
          No empire named <span className="font-medium text-st-fg">{empireName}</span> appears in
          the active game. Seed a map that includes this faction or choose another game from Lobby.
        </p>
      </Card>
    );

  return (
    <GalaxyMapNavProvider>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <GalaxyViewport
          playerHomeMapLayout
          playerEmpireId={empireId}
          starPanelAside={aside}
        />
      </div>
    </GalaxyMapNavProvider>
  );
}
