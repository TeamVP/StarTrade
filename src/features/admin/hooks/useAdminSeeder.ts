import { useMutation } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";

export function useAdminSeeder() {
  const reseedGame = useMutation(api.admin.mutations.reseedGame);
  return async (gameId: Id<"sim_games">, mapKey: string) =>
    reseedGame({ gameId, mapKey });
}
