import { Card } from "@/components/ui/card";
import { CombatScreen } from "@/features/combat/components/CombatScreen";
import { usePlayerEmpireId, usePlayerGameMembership } from "@/features/player/PlayerPreviewContext";

export function PlayerCombatPage() {
  const empireId = usePlayerEmpireId();
  const membership = usePlayerGameMembership();
  const hasPlayerPerspective = empireId !== null || membership.actorId !== null;

  if (!hasPlayerPerspective) {
    return (
      <Card className="p-4">
        <p className="text-sm text-st-muted">
          {membership.isSpectator ? (
            <>
              You joined this game as <span className="font-medium text-st-fg">{membership.label}</span>,
              so combat messages are shown without an empire filter.
            </>
          ) : (
            <>
              No empire named <span className="font-medium text-st-fg">{membership.label}</span> in the active
              game, so combat messages cannot be scoped to your faction yet.
            </>
          )}
        </p>
      </Card>
    );
  }

  return (
    <CombatScreen
      playerPerspective={{
        empireId,
        actorId: membership.actorId,
        label: membership.label,
      }}
    />
  );
}
