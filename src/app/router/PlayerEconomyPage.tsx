import { EconomyScreen } from "@/features/economy/components/EconomyScreen";
import { usePlayerEmpireId } from "@/features/player/PlayerPreviewContext";

export function PlayerEconomyPage() {
  const empireId = usePlayerEmpireId();
  return <EconomyScreen playerEmpireId={empireId} hideGamePicker />;
}
