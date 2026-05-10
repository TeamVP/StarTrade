import { useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";

export function useTraderCharters(gameId: Id<"sim_games"> | null) {
  return (
    useQuery(
      api.trd.queries.listTraderCharters,
      gameId ? { gameId } : "skip",
    ) ?? []
  );
}
