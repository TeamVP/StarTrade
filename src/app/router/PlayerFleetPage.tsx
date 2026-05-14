import { FleetScreen } from "@/features/fleet/components/FleetScreen";
import { usePlayerEmpireId } from "@/features/player/PlayerPreviewContext";

export function PlayerFleetPage() {
  const empireId = usePlayerEmpireId();
  return <FleetScreen playerEmpireId={empireId} />;
}
