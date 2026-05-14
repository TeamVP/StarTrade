import { useMutation } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";

type IssueOrderArgs = {
  gameId: Id<"sim_games">;
  fleetId: Id<"flt_fleets">;
  turnNumber?: number;
  orderType: "move" | "hold";
  targetSystemId: Id<"gal_systems"> | null;
  shipCount?: number;
  standingRouteDispatchPct?: number;
};

export function useFleetOrders() {
  const issueFleetOrder = useMutation(api.flt.mutations.issueFleetOrder);
  return (args: IssueOrderArgs) => issueFleetOrder(args);
}
