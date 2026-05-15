import { useState } from "react";
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
  const canCreateNewStarterGame =
    empireId === null &&
    activeGame !== null &&
    activeGame?.lobbyScenarioKey !== null &&
    (activeGame.status === "finished" || membership.isSpectator);

  async function onCreateNewStarterGame() {
    if (activeGame?.lobbyScenarioKey === null || activeGame?.lobbyScenarioKey === undefined) {
      return;
    }
    setNewGameBusy(true);
    setNewGameError(null);
    try {
      const result = await resetMyStarterGame({ scenarioKey: activeGame.lobbyScenarioKey });
      setSelectedGameId(result.gameId as Parameters<typeof setSelectedGameId>[0]);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setNewGameError(message.replace(/^[\s\S]*?Error:\s*/g, "").trim());
    } finally {
      setNewGameBusy(false);
    }
  }

  const aside =
    empireId !== null ? (
      <EmpirePanel focusEmpireId={empireId} />
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
              Create a fresh run for this same starter scenario and switch this view to it.
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
          playerEmpireId={empireId}
          starPanelAside={aside}
          initialFocusFleetId={focusFleetId}
        />
      </div>
    </GalaxyMapNavProvider>
  );
}
