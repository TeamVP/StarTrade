import type { Doc } from "../_generated/dataModel";

/** Undirected adjacency: system id → neighbors with hop travel turns. */
export type HyperlaneAdjacency = Map<
  string,
  Array<{ neighborId: string; travelTurns: number }>
>;

export function buildUndirectedHyperlaneAdjacency(
  links: Doc<"gal_links">[],
  edgeTravelTurns: (travelCost: number) => number,
): HyperlaneAdjacency {
  const adj: HyperlaneAdjacency = new Map();
  const addHalf = (from: string, to: string, turns: number) => {
    const list = adj.get(from) ?? [];
    list.push({ neighborId: to, travelTurns: turns });
    adj.set(from, list);
  };

  for (const link of links) {
    const turns = edgeTravelTurns(link.travelCost);
    const a = link.fromSystemId as string;
    const b = link.toSystemId as string;
    addHalf(a, b, turns);
    addHalf(b, a, turns);
  }

  return adj;
}

/**
 * Dijkstra shortest travel-turn sum from `startId` to every reachable system.
 */
export function shortestTravelTurnsFromStart(
  startId: string,
  adjacency: HyperlaneAdjacency,
): Map<string, number> {
  const dist = new Map<string, number>();
  dist.set(startId, 0);
  const visited = new Set<string>();

  for (;;) {
    let bestId: string | null = null;
    let bestD = Infinity;
    for (const [id, d] of dist) {
      if (!visited.has(id) && d < bestD) {
        bestD = d;
        bestId = id;
      }
    }
    if (bestId === null || bestD === Infinity) break;

    visited.add(bestId);
    for (const { neighborId, travelTurns } of adjacency.get(bestId) ?? []) {
      const nd = bestD + travelTurns;
      const prev = dist.get(neighborId);
      if (prev === undefined || nd < prev) {
        dist.set(neighborId, nd);
      }
    }
  }

  return dist;
}

export function shortestTravelTurnsBetween(
  fromSystemId: string,
  toSystemId: string,
  adjacency: HyperlaneAdjacency,
): number | null {
  if (fromSystemId === toSystemId) return 0;
  const dist = shortestTravelTurnsFromStart(fromSystemId, adjacency);
  const d = dist.get(toSystemId);
  return d === undefined ? null : d;
}
