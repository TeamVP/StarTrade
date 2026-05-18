import type { Id } from "../_generated/dataModel";
import { MAX_COLONY_ROUTE_HOPS_BEYOND_EMPIRE } from "./constants";

type ColonyRouteOwner = {
  ownerEmpireId: Id<"emp_states"> | null | undefined;
  ownerActorId?: Id<"sim_game_actors"> | null | undefined;
};

/**
 * Validates ordered destination systems (not including homeworld).
 * Rule: a prefix of systems may be owned by `empireId`; after the first non-owned
 * system, at most {@link MAX_COLONY_ROUTE_HOPS_BEYOND_EMPIRE} more systems are allowed.
 */
export function validateColonyShipRouteDestinations(params: {
  routeSystemIds: readonly Id<"gal_systems">[];
  empireId?: Id<"emp_states"> | null | undefined;
  actorId?: Id<"sim_game_actors"> | null | undefined;
  getOwner: (systemId: Id<"gal_systems">) => ColonyRouteOwner;
}): string | null {
  const { routeSystemIds, empireId, actorId, getOwner } = params;
  if (routeSystemIds.length === 0) {
    return "Route must include at least one destination system.";
  }
  if (new Set(routeSystemIds).size !== routeSystemIds.length) {
    return "Route cannot visit the same system twice.";
  }
  let k = 0;
  while (k < routeSystemIds.length) {
    const owner = getOwner(routeSystemIds[k]);
    if (
      actorId !== null &&
      actorId !== undefined &&
      owner.ownerActorId !== null &&
      owner.ownerActorId !== undefined
    ) {
      if (owner.ownerActorId === actorId) {
        k++;
        continue;
      }
      break;
    }
    if (empireId !== null && empireId !== undefined && owner.ownerEmpireId === empireId) {
      k++;
      continue;
    }
    break;
  }
  const tailLen = routeSystemIds.length - k;
  if (tailLen > MAX_COLONY_ROUTE_HOPS_BEYOND_EMPIRE) {
    return `Colony ships may only continue up to ${MAX_COLONY_ROUTE_HOPS_BEYOND_EMPIRE} hyperspace hops beyond your empire's territory.`;
  }
  return null;
}
