import { useState, useEffect } from "react";
import { useMutation } from "convex/react";
import { useLocation } from "react-router-dom";
import { api } from "../../../convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { GalaxyViewport } from "@/features/galaxy/components/GalaxyViewport";
import { GalaxyMapNavProvider } from "@/features/galaxy/context/GalaxyMapNavContext";
import { EmpirePanel } from "@/features/empire/components/EmpirePanel";
import { useActiveGame } from "@/features/galaxy/hooks/useActiveGame";
import { usePlayerEmpireId, usePlayerGameMembership } from "@/features/player/PlayerPreviewContext";
import type { Id } from "../../../convex/_generated/dataModel";

function focusFleetIdFromState(state: unknown): string | null {
  if (state === null || typeof state !== "object") return null;
  const value = (state as { focusFleetId?: unknown }).focusFleetId;
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function PlayerHomePage() {
  const location = useLocation();
  const empireId = usePlayerEmpireId();
  const membership = usePlayerGameMembership();
  const { activeGame, setSelectedGameId } = useActiveGame();
  const resetMyStarterGame = useMutation(api.usr.mutations.resetMyStarterGame);
  const [newGameBusy, setNewGameBusy] = useState(false);
  const [newGameError, setNewGameError] = useState<string | null>(null);
  const focusFleetId = focusFleetIdFromState(location.state);
  const activeMissionKey = activeGame?.missionKey ?? activeGame?.lobbyScenarioKey ?? null;

  // Latch the last known empire ID so the map and empire panel stay intact
  // when the game ends and the empire record is cleaned up (game-end modal flow).
  const [lastKnownEmpireId, setLastKnownEmpireId] = useState<Id<"emp_states"> | null>(empireId);
  const [lastKnownActorId, setLastKnownActorId] = useState<Id<"sim_game_actors"> | null>(
    membership.actorId,
  );
  useEffect(() => {
    if (empireId !== null) setLastKnownEmpireId(empireId);
  }, [empireId]);
  useEffect(() => {
    if (membership.actorId !== null) setLastKnownActorId(membership.actorId);
  }, [membership.actorId]);
  // Use the real empireId when available; fall back to last-known only when we
  // previously had one (i.e. the player was not a spectator to begin with).
  const displayEmpireId = empireId ?? lastKnownEmpireId;
  const displayActorId = membership.actorId ?? lastKnownActorId;

  const canCreateNewStarterGame =
    empireId === null &&
    lastKnownEmpireId === null &&
    activeGame !== null &&
    activeMissionKey !== null &&
    (activeGame.status === "finished" || membership.isSpectator);

  async function onCreateNewStarterGame() {
    if (activeMissionKey === null) {
      return;
    }
    setNewGameBusy(true);
    setNewGameError(null);
    try {
      const result = await resetMyStarterGame({ scenarioKey: activeMissionKey });
      setSelectedGameId(result.gameId as Parameters<typeof setSelectedGameId>[0]);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setNewGameError(message.replace(/^[\s\S]*?Error:\s*/g, "").trim());
    } finally {
      setNewGameBusy(false);
    }
  }

  const aside =
    displayEmpireId !== null || displayActorId !== null ? (
      <EmpirePanel focusEmpireId={displayEmpireId} focusActorId={displayActorId} />
    ) : (
      <Card className="p-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-st-muted">
          Empire Snapshot
        </h2>
        <p className="mt-3 text-sm text-st-muted">
          {membership.isSpectator ? (
            <>
              You joined this game as <span className="font-medium text-st-fg">{membership.label}</span>.
              Spectators can inspect the map, but they do not have an empire snapshot.
            </>
          ) : (
            <>
              No empire named <span className="font-medium text-st-fg">{membership.label}</span> appears in
              the active game. Seed a map that includes this faction or choose another game from Lobby.
            </>
          )}
        </p>
        {canCreateNewStarterGame ? (
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Button
              type="button"
              disabled={newGameBusy}
              onClick={() => {
                void onCreateNewStarterGame();
              }}
            >
              {newGameBusy ? "Working..." : "New game"}
            </Button>
            <p className="text-xs text-st-muted">
              Create a fresh run for this same mission and switch this view to it.
            </p>
          </div>
        ) : null}
        {newGameError !== null ? (
          <p className="mt-2 text-xs text-red-600 dark:text-red-400" role="alert">
            {newGameError}
          </p>
        ) : null}
      </Card>
    );

  return (
    <GalaxyMapNavProvider>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <GalaxyViewport
          playerHomeMapLayout
          playerEmpireId={displayEmpireId}
          starPanelAside={aside}
          initialFocusFleetId={focusFleetId}
        />
      </div>
    </GalaxyMapNavProvider>
  );
}
