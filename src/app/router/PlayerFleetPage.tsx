import { FleetScreen } from "@/features/fleet/components/FleetScreen";
import { usePlayerEmpireId, usePlayerPreview } from "@/features/player/PlayerPreviewContext";

export function PlayerFleetPage() {
  const empireId = usePlayerEmpireId();
  const { basePath } = usePlayerPreview();
  return <FleetScreen playerEmpireId={empireId} galaxyPath={basePath} />;
}
