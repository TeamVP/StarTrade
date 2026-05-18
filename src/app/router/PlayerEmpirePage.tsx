import { EmpiresPage } from "@/features/empire/components/EmpiresPage";
import { usePlayerGameMembership } from "@/features/player/PlayerPreviewContext";

export function PlayerEmpirePage() {
  const membership = usePlayerGameMembership();
  return (
    <EmpiresPage
      onlyEmpireId={membership.empireId}
      onlyActorId={membership.actorId}
      hideGamePicker
    />
  );
}
