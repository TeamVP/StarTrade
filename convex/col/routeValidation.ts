import type { Id } from "../_generated/dataModel";
import { MAX_COLONY_ROUTE_HOPS_BEYOND_EMPIRE } from "./constants";

/**
 * Validates ordered destination systems (not including homeworld).
 * Rule: a prefix of systems may be owned by `empireId`; after the first non-owned
 * system, at most {@link MAX_COLONY_ROUTE_HOPS_BEYOND_EMPIRE} more systems are allowed.
 */
export function validateColonyShipRouteDestinations(params: {
  routeSystemIds: readonly Id<"gal_systems">[];
  empireId: Id<"emp_states">;
  getOwner: (systemId: Id<"gal_systems">) => Id<"emp_states"> | null | undefined;
}): string | null {
  const { routeSystemIds, empireId, getOwner } = params;
  if (routeSystemIds.length === 0) {
    return "Route must include at least one destination system.";
  }
  if (new Set(routeSystemIds).size !== routeSystemIds.length) {
    return "Route cannot visit the same system twice.";
  }
  let k = 0;
  while (k < routeSystemIds.length) {
    const owner = getOwner(routeSystemIds[k]);
    if (owner === empireId) k++;
    else break;
  }
  const tailLen = routeSystemIds.length - k;
  if (tailLen > MAX_COLONY_ROUTE_HOPS_BEYOND_EMPIRE) {
    return `Colony ships may only continue up to ${MAX_COLONY_ROUTE_HOPS_BEYOND_EMPIRE} hyperspace hops beyond your empire's territory.`;
  }
  return null;
}
