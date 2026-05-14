/**
 * v1-spiral: 10 donut-shaped clusters along a mother spiral.
 * Lanes: each cluster is a perimeter ring (all intra-cluster stars connected in one cycle);
 * between clusters, each arm links to its two closest centroid neighbors and to the farthest arm.
 */

import {
  MIN_STAR_PAIRWISE_DISTANCE_WORLD,
  enforceMinPairwiseSeparation,
} from "./enforceMinStarSeparation";

export const V1_SPIRAL_WORLD_WIDTH = 4200;
export const V1_SPIRAL_WORLD_HEIGHT = 2480;

/** Link metric scale vs medium (~72) for similar turn costs on longer edges. */
export const V1_SPIRAL_LINK_DISTANCE_SCALE = 160;

export const V1_SPIRAL_SYSTEM_COUNT = 200;

export type V1SpiralStartingOwner = "neutral" | "aurora" | "iron";

export type V1SpiralSeedSystem = {
  key: string;
  name: string;
  x: number;
  y: number;
  resourceRichness: number;
  isHomeworld: boolean;
  startingOwner: V1SpiralStartingOwner;
};

export type V1SpiralLaneKey = { fromKey: string; toKey: string };

const SPIRAL_ARMS = 10;
const STARS_PER_ARM = 20;
const HALF_RING = STARS_PER_ARM / 2;

/** Annulus radii (px) from cluster center — separation pass finishes spacing vs UI hit targets. */
const DONUT_INNER_R = 72;
const DONUT_OUTER_R = 178;

/** Slightly widen mother curve so donut clusters seldom overlap visually. */
const MOTHER_PHASE_STEP = 0.52;
const MOTHER_R_BASE = 126;
const MOTHER_R_GROWTH = 92;

function clampRichness(value: number): number {
  return Math.max(0.15, Math.min(0.95, Math.round(value * 100) / 100));
}

/** `spiral-a{arm}-s{slot}` → arm index */
function spiralArmFromKey(key: string): number {
  const m = /^spiral-a(\d+)-s\d+$/.exec(key);
  if (!m) throw new Error(`v1-spiral: bad systemKey ${key}`);
  return Number(m[1]);
}

function centroidOf(systems: ReadonlyArray<{ x: number; y: number }>): {
  cx: number;
  cy: number;
} {
  let sx = 0;
  let sy = 0;
  for (const s of systems) {
    sx += s.x;
    sy += s.y;
  }
  const n = systems.length;
  return { cx: sx / n, cy: sy / n };
}

function canonLanePair(aKey: string, bKey: string): string {
  return aKey < bKey ? `${aKey}\0${bKey}` : `${bKey}\0${aKey}`;
}

function shortestLaneAcross(
  aa: readonly V1SpiralSeedSystem[],
  bb: readonly V1SpiralSeedSystem[],
): V1SpiralLaneKey {
  let bestDa = aa[0]!;
  let bestDb = bb[0]!;
  let bestD = Infinity;
  for (const sa of aa) {
    for (const sb of bb) {
      const d = Math.hypot(sa.x - sb.x, sa.y - sb.y);
      if (d < bestD) {
        bestD = d;
        bestDa = sa;
        bestDb = sb;
      }
    }
  }
  return { fromKey: bestDa.key, toKey: bestDb.key };
}

function clusterSystemsByArm(systems: V1SpiralSeedSystem[]): V1SpiralSeedSystem[][] {
  const arms: V1SpiralSeedSystem[][] = Array.from({ length: SPIRAL_ARMS }, () => []);
  for (const s of systems) {
    const arm = spiralArmFromKey(s.key);
    arms[arm]!.push(s);
  }
  for (let a = 0; a < SPIRAL_ARMS; a++) {
    if (arms[a]!.length !== STARS_PER_ARM) {
      throw new Error(
        `v1-spiral: arm ${a} expected ${STARS_PER_ARM} systems, got ${arms[a]!.length}`,
      );
    }
  }
  return arms;
}

/**
 * Cyclic perimeter on the donut: sort by polar angle around cluster centroid, connect consecutive vertices.
 */
function addIntraClusterRingLanes(
  cluster: readonly V1SpiralSeedSystem[],
  laneSeen: Set<string>,
  lanes: V1SpiralLaneKey[],
): void {
  const { cx, cy } = centroidOf(cluster);
  const ordered = [...cluster].sort(
    (a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx),
  );
  const n = ordered.length;
  for (let i = 0; i < n; i++) {
    const aKey = ordered[i]!.key;
    const bKey = ordered[(i + 1) % n]!.key;
    const canon = canonLanePair(aKey, bKey);
    if (!laneSeen.has(canon)) {
      laneSeen.add(canon);
      lanes.push({ fromKey: aKey, toKey: bKey });
    }
  }
}

function addInterClusterLane(
  a: readonly V1SpiralSeedSystem[],
  b: readonly V1SpiralSeedSystem[],
  laneSeen: Set<string>,
  lanes: V1SpiralLaneKey[],
): void {
  const { fromKey, toKey } = shortestLaneAcross(a, b);
  const canon = canonLanePair(fromKey, toKey);
  if (laneSeen.has(canon)) return;
  laneSeen.add(canon);
  lanes.push({ fromKey, toKey });
}

function buildLanes(systems: V1SpiralSeedSystem[]): V1SpiralLaneKey[] {
  const arms = clusterSystemsByArm(systems);
  const centroids = arms.map((c) => centroidOf(c));

  const laneSeen = new Set<string>();
  const lanes: V1SpiralLaneKey[] = [];

  for (const cluster of arms) {
    addIntraClusterRingLanes(cluster, laneSeen, lanes);
  }

  for (let a = 0; a < SPIRAL_ARMS; a++) {
    const others = [];
    for (let b = 0; b < SPIRAL_ARMS; b++) {
      if (b === a) continue;
      const dx = centroids[a]!.cx - centroids[b]!.cx;
      const dy = centroids[a]!.cy - centroids[b]!.cy;
      others.push({ b, d: Math.hypot(dx, dy) });
    }
    others.sort((u, v) => u.d - v.d || u.b - v.b);

    addInterClusterLane(arms[a]!, arms[others[0]!.b]!, laneSeen, lanes);
    if (others.length > 1) {
      addInterClusterLane(arms[a]!, arms[others[1]!.b]!, laneSeen, lanes);
    }
    const farthest = others[others.length - 1]!;
    addInterClusterLane(arms[a]!, arms[farthest.b]!, laneSeen, lanes);
  }

  ensureGloballyConnected(systems, lanes, laneSeen);
  assertConnected(systems.map((s) => s.key), lanes);
  return lanes;
}

function ensureGloballyConnected(
  systems: readonly V1SpiralSeedSystem[],
  lanes: V1SpiralLaneKey[],
  laneSeen: Set<string>,
): void {
  let keysVisited = reachableKeys(systems.map((s) => s.key), lanes);
  if (keysVisited.size === systems.length) return;

  const keyRows = systems;

  while (keysVisited.size < systems.length) {
    const outside = systems.filter((s) => !keysVisited.has(s.key));
    let best: V1SpiralLaneKey | null = null;
    let bestDist = Infinity;
    for (const k of keysVisited) {
      const sa = keyRows.find((r) => r.key === k);
      if (!sa) continue;
      for (const sb of outside) {
        const d = Math.hypot(sa.x - sb.x, sa.y - sb.y);
        if (d < bestDist) {
          bestDist = d;
          best = { fromKey: sa.key, toKey: sb.key };
        }
      }
    }
    if (!best) {
      throw new Error("v1-spiral: failed to bridge disconnected lane components");
    }
    const canon = canonLanePair(best.fromKey, best.toKey);
    if (!laneSeen.has(canon)) {
      laneSeen.add(canon);
      lanes.push(best);
    }
    keysVisited = reachableKeys(systems.map((s) => s.key), lanes);
  }
}

function reachableKeys(allKeys: string[], lanes: readonly V1SpiralLaneKey[]): Set<string> {
  const adj = new Map<string, string[]>();
  for (const k of allKeys) adj.set(k, []);
  for (const { fromKey, toKey } of lanes) {
    adj.get(fromKey)!.push(toKey);
    adj.get(toKey)!.push(fromKey);
  }
  const start = allKeys[0]!;
  const visited = new Set<string>([start]);
  const queue = [start];
  while (queue.length > 0) {
    const k = queue.pop()!;
    for (const nb of adj.get(k)!) {
      if (!visited.has(nb)) {
        visited.add(nb);
        queue.push(nb);
      }
    }
  }
  return visited;
}

function assertConnected(allKeys: string[], lanes: readonly V1SpiralLaneKey[]): void {
  const v = reachableKeys(allKeys, lanes);
  if (v.size !== allKeys.length) {
    throw new Error(
      `v1-spiral: lane graph disconnected (${v.size}/${allKeys.length} reachable after bridge)`,
    );
  }
}

function buildSystems(): V1SpiralSeedSystem[] {
  const systems: V1SpiralSeedSystem[] = [];
  const W = V1_SPIRAL_WORLD_WIDTH;
  const H = V1_SPIRAL_WORLD_HEIGHT;

  for (let arm = 0; arm < SPIRAL_ARMS; arm++) {
    const u = arm * MOTHER_PHASE_STEP + 0.15;
    const motherR = MOTHER_R_BASE + arm * MOTHER_R_GROWTH;
    const cx =
      W * 0.5 +
      Math.cos(u * 1.18) * motherR * 1.42 +
      Math.sin(arm * 0.55) * 44;
    const cy =
      H * 0.5 +
      Math.sin(u * 1.18) * motherR * 1.05 +
      Math.cos(arm * 0.62) * 56;
    const armRotation =
      arm * 0.37 + Math.sin(u * 0.9) * 0.28 + MOTHER_PHASE_STEP * arm * 0.09;

    for (let slot = 0; slot < STARS_PER_ARM; slot++) {
      const ringTier = slot % 2 === 0 ? DONUT_OUTER_R : DONUT_INNER_R;
      const turn = slot >> 1;
      /** Interleaved outer/inner decagons (“donut”). */
      const theta =
        armRotation +
        (turn / HALF_RING) * 2 * Math.PI +
        (slot % 2 === 1 ? Math.PI / HALF_RING : 0) +
        0.03 * Math.sin(turn * 1.1 + arm);
      const rJitter =
        1 +
        0.06 * Math.sin(slot * 1.7 + arm * 0.8) +
        0.04 * Math.cos(turn * 2.3);
      const r = ringTier * rJitter;

      let x = Math.round(cx + Math.cos(theta) * r);
      let y = Math.round(cy + Math.sin(theta) * r);
      x += ((arm * 19 + slot * 11) % 23) - 11;
      y += ((arm * 17 + slot * 7) % 21) - 10;
      x = Math.max(40, Math.min(W - 40, x));
      y = Math.max(40, Math.min(H - 40, y));

      const startingOwner: V1SpiralStartingOwner = "neutral";
      const richnessBase = 0.36 + (arm % 6) * 0.048 + (SPIRAL_ARMS - arm) * 0.006;
      const jitter = (((arm * 7 + slot * 5) % 13) - 6) / 100;

      systems.push({
        key: `spiral-a${arm}-s${slot}`,
        name: `Arm ${arm + 1} · Ring ${slot + 1}`,
        x,
        y,
        resourceRichness: clampRichness(richnessBase + jitter),
        isHomeworld: false,
        startingOwner,
      });
    }
  }

  enforceMinPairwiseSeparation(systems, {
    minDistance: MIN_STAR_PAIRWISE_DISTANCE_WORLD,
    minX: 32,
    maxX: W - 32,
    minY: 32,
    maxY: H - 32,
    relaxPerCycle: 32,
    maxCycles: 85,
  });

  return systems;
}

export function makeSpiralLinkMetrics(
  ax: number,
  ay: number,
  bx: number,
  by: number,
): { distance: number; travelCost: number } {
  const d = Math.hypot(ax - bx, ay - by);
  const distance = Math.max(1, Math.round(d / V1_SPIRAL_LINK_DISTANCE_SCALE));
  return { distance, travelCost: distance * 2 };
}

export const V1_SPIRAL_SYSTEMS = buildSystems();
export const V1_SPIRAL_LANE_KEYS = buildLanes(V1_SPIRAL_SYSTEMS);
