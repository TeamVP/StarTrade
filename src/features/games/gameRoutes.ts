import type { Id } from "../../../convex/_generated/dataModel";

type GameRouteTarget =
  | { _id: Id<"sim_games">; urlCode?: string | null }
  | { gameId: Id<"sim_games">; urlCode?: string | null };

export function getGameRouteKey(target: GameRouteTarget): string {
  return target.urlCode ?? ("_id" in target ? target._id : target.gameId);
}

export function getGamePath(target: GameRouteTarget): string {
  return `/game/${getGameRouteKey(target)}`;
}
