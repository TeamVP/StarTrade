import { useContext, useEffect, useMemo } from "react";
import { useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import type { Doc } from "../../../../convex/_generated/dataModel";
import { ActiveGameContext } from "../context/ActiveGameContext";

const LIST_GAMES_LIMIT = 100;

function useActiveGameSelection() {
  const ctx = useContext(ActiveGameContext);
  if (ctx === null) {
    throw new Error("useActiveGame must be used within ActiveGameProvider");
  }
  return ctx;
}

/**
 * Resolves the active game from the games list and admin/user selection.
 * Falls back to the most recently created game when nothing is selected.
 */
export function useActiveGame(): {
  activeGame: Doc<"sim_games"> | null;
  games: Doc<"sim_games">[];
  setSelectedGameId: (id: Doc<"sim_games">["_id"] | null) => void;
} {
  const { selectedGameId, setSelectedGameId } = useActiveGameSelection();
  const gamesQuery = useQuery(api.sim.queries.listGames, { limit: LIST_GAMES_LIMIT });
  const games = useMemo(() => gamesQuery ?? [], [gamesQuery]);

  const activeGame = useMemo((): Doc<"sim_games"> | null => {
    if (games.length === 0) {
      return null;
    }
    if (selectedGameId !== null) {
      const found = games.find((g) => g._id === selectedGameId);
      if (found !== undefined) {
        return found;
      }
    }
    return games[0] ?? null;
  }, [games, selectedGameId]);

  useEffect(() => {
    if (selectedGameId === null || games.length === 0) {
      return;
    }
    const exists = games.some((g) => g._id === selectedGameId);
    if (!exists) {
      setSelectedGameId(null);
    }
  }, [games, selectedGameId, setSelectedGameId]);

  return { activeGame, games, setSelectedGameId };
}
