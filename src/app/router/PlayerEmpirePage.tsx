import { EmpiresPage } from "@/features/empire/components/EmpiresPage";
import { usePlayerEmpireId } from "@/features/player/PlayerPreviewContext";

export function PlayerEmpirePage() {
  const empireId = usePlayerEmpireId();
  return <EmpiresPage onlyEmpireId={empireId} hideGamePicker />;
}
