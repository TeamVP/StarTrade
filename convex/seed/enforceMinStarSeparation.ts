/**
 * Iterative separation so seeded stars stay far enough apart for the galaxy UI:
 * Pixi draws star disks / hit targets in world units (`STAR_HIT_RADIUS`, orbit rings in
 * `src/features/galaxy/constants.ts`). Convex seeds cannot import the frontend module;
 * keep `MIN_STAR_PAIRWISE_DISTANCE_WORLD` in sync when tuning clicks.
 *
 * Algorithm: Jacobi-style pairwise overlap correction + optional radial scaling
 * from the layout centroid when pushes hit map bounds (preserves loose shape).
 */

export type SeparationBounds = {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
};

export type EnforceMinSeparationOpts = SeparationBounds & {
  /** Minimum Euclidean distance between every pair of systems (world units). */
  minDistance: number;
  /** Inner relaxation iterations per outer cycle (default 28). */
  relaxPerCycle?: number;
  /** Outer cycles combining relax + radial expand (default 70). */
  maxCycles?: number;
  /** Apply centroid scaling when separation stalls (default true). */
  allowRadialExpansion?: boolean;
};

/** Comfortable floor vs overlapping STAR_HIT_RADIUS disks + fleet orbit clutter. */
export const MIN_STAR_PAIRWISE_DISTANCE_WORLD = 78;

function clampToBounds<T extends { x: number; y: number }>(
  p: T,
  b: SeparationBounds,
): void {
  p.x = Math.max(b.minX, Math.min(b.maxX, p.x));
  p.y = Math.max(b.minY, Math.min(b.maxY, p.y));
}

function centroid<T extends { x: number; y: number }>(
  systems: readonly T[],
): { cx: number; cy: number } {
  let sx = 0;
  let sy = 0;
  for (const s of systems) {
    sx += s.x;
    sy += s.y;
  }
  const n = systems.length;
  return { cx: sx / n, cy: sy / n };
}

/** Minimum center-to-center distance over all unordered pairs. */
export function minPairwiseDistance(systems: readonly { x: number; y: number }[]): number {
  const n = systems.length;
  let m = Infinity;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const d = Math.hypot(systems[i]!.x - systems[j]!.x, systems[i]!.y - systems[j]!.y);
      if (d < m) m = d;
    }
  }
  return m === Infinity ? 0 : m;
}

function jacobiRelaxCycle<T extends { x: number; y: number }>(
  systems: T[],
  minD: number,
  bounds: SeparationBounds,
  damping: number,
): boolean {
  const n = systems.length;
  const dx = new Float64Array(n);
  const dy = new Float64Array(n);

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const si = systems[i]!;
      const sj = systems[j]!;
      let vx = sj.x - si.x;
      let vy = sj.y - si.y;
      let dist = Math.hypot(vx, vy);
      if (dist < 1e-9) {
        vx = Math.cos(i * 2.31 + j * 1.07);
        vy = Math.sin(i * 2.31 + j * 1.07);
        dist = 1;
      }
      if (dist >= minD) continue;
      const overlap = minD - dist;
      const ux = vx / dist;
      const uy = vy / dist;
      const half = (overlap / 2) * damping;
      dx[i] -= ux * half;
      dy[i] -= uy * half;
      dx[j] += ux * half;
      dy[j] += uy * half;
    }
  }

  let moved = false;
  for (let i = 0; i < n; i++) {
    if (dx[i] !== 0 || dy[i] !== 0) moved = true;
    systems[i]!.x += dx[i]!;
    systems[i]!.y += dy[i]!;
    clampToBounds(systems[i]!, bounds);
  }
  return moved;
}

function radialExpandFromCentroid<T extends { x: number; y: number }>(
  systems: T[],
  bounds: SeparationBounds,
  factor: number,
): void {
  const { cx, cy } = centroid(systems);
  const f = factor;
  for (const s of systems) {
    s.x = cx + (s.x - cx) * f;
    s.y = cy + (s.y - cy) * f;
    clampToBounds(s, bounds);
  }
}

/**
 * Mutates `systems` in place so every pair is at least `opts.minDistance` apart,
 * clamped to bounds. Throws if constraints cannot be met within iteration budgets.
 */
export function enforceMinPairwiseSeparation<T extends { x: number; y: number }>(
  systems: T[],
  opts: EnforceMinSeparationOpts,
): void {
  const minD = opts.minDistance;
  const relaxPerCycle = opts.relaxPerCycle ?? 28;
  const maxCycles = opts.maxCycles ?? 70;
  const allowRadial = opts.allowRadialExpansion ?? true;

  const bounds: SeparationBounds = {
    minX: opts.minX,
    maxX: opts.maxX,
    minY: opts.minY,
    maxY: opts.maxY,
  };

  for (let cycle = 0; cycle < maxCycles; cycle++) {
    const damping = 0.62 + 0.38 * (1 - cycle / Math.max(1, maxCycles - 1));
    for (let k = 0; k < relaxPerCycle; k++) {
      jacobiRelaxCycle(systems, minD, bounds, damping);
    }

    let md = minPairwiseDistance(systems);
    if (md >= minD - 0.25) break;

    if (allowRadial && md > 1e-9) {
      const factor = Math.min(1.1, minD / md);
      radialExpandFromCentroid(systems, bounds, factor);
    }

    md = minPairwiseDistance(systems);
    if (md >= minD - 0.25) break;
  }

  const mdFinal = minPairwiseDistance(systems);
  if (mdFinal < minD - 0.75) {
    throw new Error(
      `enforceMinPairwiseSeparation: could not reach minDistance ${minD} (got ${mdFinal.toFixed(
        2,
      )}); widen bounds or reduce star count.`,
    );
  }

  for (const s of systems) {
    s.x = Math.round(s.x);
    s.y = Math.round(s.y);
    clampToBounds(s, bounds);
  }

  for (let polish = 0; polish < 16; polish++) {
    jacobiRelaxCycle(systems, minD, bounds, 0.92);
  }

  const mdAfterRound = minPairwiseDistance(systems);
  if (mdAfterRound < minD - 1.25) {
    throw new Error(
      `enforceMinPairwiseSeparation: rounding broke separation (${mdAfterRound.toFixed(
        2,
      )} < ${minD}).`,
    );
  }
}
