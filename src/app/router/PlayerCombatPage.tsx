import { Card } from "@/components/ui/card";
import { CombatScreen } from "@/features/combat/components/CombatScreen";
import { usePlayerEmpireId, usePlayerPreview } from "@/features/player/PlayerPreviewContext";

export function PlayerCombatPage() {
  const { empireName } = usePlayerPreview();
  const empireId = usePlayerEmpireId();

  if (empireId === null) {
    return (
      <Card className="p-4">
        <p className="text-sm text-st-muted">
          No empire named <span className="font-medium text-st-fg">{empireName}</span> in the active
          game, so combat messages cannot be scoped to your faction yet.
        </p>
      </Card>
    );
  }

  return (
    <CombatScreen playerPerspective={{ empireId, label: empireName }} />
  );
}
