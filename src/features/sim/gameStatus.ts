import type { Doc } from "../../../convex/_generated/dataModel";

/** Lobby/finished games cannot issue orders; paused games still allow planning orders. */
export function gameAllowsPlayerOrders(
  status: Doc<"sim_games">["status"] | undefined,
): boolean {
  return status === "running" || status === "paused";
}
