/**
 * Spatial hyperlane builder.
 *
 * Step 1 — Minimum Spanning Tree (Kruskal's):
 *   Guarantees every star is reachable from every other star using the
 *   globally shortest edges required for connectivity. MST edges are always
 *   added regardless of distance or degree.
 *
 * Step 2 — k-Nearest neighbor additions (distance-capped, degree-capped):
 *   For each star, attempt to link up to `kNearest` closest neighbours that
 *   aren't already connected. Skipped when either endpoint is already at
 *   `maxDegree` or when the edge length exceeds `maxAddLaneDistance`.
 *   This creates the ~90% "local routes" feel without long visual crossings.
 */
export function buildProximityLanes(
  systems: { key: string; x: number; y: number }[],
  opts: {
    /** Extra local connections per star beyond the MST (default 3). */
    kNearest?: number;
    /**
     * Maximum edge length for non-MST k-nearest additions.
     * MST edges are always kept. Set to keep additions within roughly
     * one neighbourhood radius.
     */
    maxAddLaneDistance?: number;
    /**
     * Maximum number of lanes touching any single star (default 5).
     * MST edges are always kept even if this limit would be breached;
     * the cap only applies to k-nearest additions.
     */
    maxDegree?: number;
  } = {},
): { fromKey: string; toKey: string }[] {
  const kNearest = opts.kNearest ?? 3;
  const maxAddDist = opts.maxAddLaneDistance ?? Infinity;
  const maxDegree = opts.maxDegree ?? 5;

  const n = systems.length;

  // ── edge list sorted by length ─────────────────────────────────────────
  type Edge = { a: number; b: number; d: number };
  const allEdges: Edge[] = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const dx = systems[i].x - systems[j].x;
      const dy = systems[i].y - systems[j].y;
      allEdges.push({ a: i, b: j, d: Math.hypot(dx, dy) });
    }
  }
  allEdges.sort((a, b) => a.d - b.d);

  // ── union-find (path-compressed) ───────────────────────────────────────
  const parent = Array.from({ length: n }, (_, i) => i);
  const ufRank = new Array<number>(n).fill(0);
  function find(x: number): number {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]]!;
      x = parent[x]!;
    }
    return x;
  }
  function union(a: number, b: number): boolean {
    const ra = find(a);
    const rb = find(b);
    if (ra === rb) return false;
    if (ufRank[ra]! < ufRank[rb]!) parent[ra] = rb;
    else if (ufRank[ra]! > ufRank[rb]!) parent[rb] = ra;
    else {
      parent[rb] = ra;
      ufRank[ra]!++;
    }
    return true;
  }

  // ── lane registry ──────────────────────────────────────────────────────
  const seen = new Set<string>();
  const degree = new Array<number>(n).fill(0);
  const lanes: { fromKey: string; toKey: string }[] = [];

  function addEdge(a: number, b: number): void {
    const pairKey = a < b ? `${a}__${b}` : `${b}__${a}`;
    if (seen.has(pairKey)) return;
    seen.add(pairKey);
    degree[a]!++;
    degree[b]!++;
    lanes.push({ fromKey: systems[a]!.key, toKey: systems[b]!.key });
  }

  // ── Step 1: MST ────────────────────────────────────────────────────────
  for (const edge of allEdges) {
    if (union(edge.a, edge.b)) {
      addEdge(edge.a, edge.b);
    }
  }

  // ── Step 2: k-nearest additions (filtered by distance + degree) ────────
  // Pre-index: for each node, sorted list of (distance, other node index)
  const nearestByNode: { j: number; d: number }[][] = Array.from(
    { length: n },
    () => [],
  );
  for (const edge of allEdges) {
    nearestByNode[edge.a]!.push({ j: edge.b, d: edge.d });
    nearestByNode[edge.b]!.push({ j: edge.a, d: edge.d });
  }

  for (let i = 0; i < n; i++) {
    let added = 0;
    for (const { j, d } of nearestByNode[i]!) {
      if (added >= kNearest) break;
      if (d > maxAddDist) break; // sorted by distance, safe to break
      const pairKey = i < j ? `${i}__${j}` : `${j}__${i}`;
      if (seen.has(pairKey)) continue; // already connected
      if (degree[i]! >= maxDegree || degree[j]! >= maxDegree) continue;
      addEdge(i, j);
      added++;
    }
  }

  return lanes;
}
