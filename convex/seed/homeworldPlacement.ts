export type HomeworldPlacementSystem = {
  key: string;
  x: number;
  y: number;
  resourceRichness: number;
};

export type BalancedHomeworldPlacement = {
  homeworldKeys: string[];
  minNearestDistance: number;
  nearestDistanceSpread: number;
  localOpportunitySpread: number;
};

type ScoredCandidate = {
  key: string;
  x: number;
  y: number;
  resourceRichness: number;
  localOpportunity: number;
};

function hashStringToUint32(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function createSeededRng(seed: string): () => number {
  let state = hashStringToUint32(seed) || 0x9e3779b9;
  return () => {
    state += 0x6d2b79f5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function distance(a: HomeworldPlacementSystem, b: HomeworldPlacementSystem): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function normalizeRange(values: number[]): number[] {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min;
  if (span <= 0) return values.map(() => 0.5);
  return values.map((value) => (value - min) / span);
}

function buildScoredCandidates(
  systems: readonly HomeworldPlacementSystem[],
): ScoredCandidate[] {
  const minX = Math.min(...systems.map((s) => s.x));
  const maxX = Math.max(...systems.map((s) => s.x));
  const minY = Math.min(...systems.map((s) => s.y));
  const maxY = Math.max(...systems.map((s) => s.y));
  const mapDiagonal = Math.max(1, Math.hypot(maxX - minX, maxY - minY));

  const rawOpportunity = systems.map((system) => {
    let score = 0;
    for (const other of systems) {
      if (other.key === system.key) continue;
      const d = distance(system, other) / mapDiagonal;
      score += other.resourceRichness / (0.12 + d * d * 8);
    }
    return score;
  });
  const normalizedOpportunity = normalizeRange(rawOpportunity);

  return systems.map((system, index) => ({
    ...system,
    localOpportunity: normalizedOpportunity[index] ?? 0.5,
  }));
}

function nearestDistances(selection: readonly HomeworldPlacementSystem[]): number[] {
  if (selection.length < 2) return selection.map(() => 0);
  return selection.map((system, index) => {
    let nearest = Infinity;
    for (let i = 0; i < selection.length; i++) {
      if (i === index) continue;
      nearest = Math.min(nearest, distance(system, selection[i]!));
    }
    return nearest;
  });
}

function scoreSelection(selection: readonly ScoredCandidate[]): {
  score: number;
  minNearestDistance: number;
  nearestDistanceSpread: number;
  localOpportunitySpread: number;
} {
  const nearest = nearestDistances(selection);
  const minNearestDistance = Math.min(...nearest);
  const nearestDistanceSpread = Math.max(...nearest) - minNearestDistance;
  const localOpportunities = selection.map((s) => s.localOpportunity);
  const localOpportunitySpread =
    Math.max(...localOpportunities) - Math.min(...localOpportunities);
  const richness = selection.map((s) => s.resourceRichness);
  const richnessSpread = Math.max(...richness) - Math.min(...richness);

  return {
    minNearestDistance,
    nearestDistanceSpread,
    localOpportunitySpread,
    score:
      minNearestDistance * 4 -
      nearestDistanceSpread * 1.4 -
      localOpportunitySpread * 260 -
      richnessSpread * 90,
  };
}

function pickGreedySelection(
  candidates: readonly ScoredCandidate[],
  count: number,
  rng: () => number,
): ScoredCandidate[] {
  const selected: ScoredCandidate[] = [];
  selected.push(candidates[Math.floor(rng() * candidates.length)]!);

  while (selected.length < count) {
    let best: { candidate: ScoredCandidate; score: number } | null = null;
    for (const candidate of candidates) {
      if (selected.some((s) => s.key === candidate.key)) continue;
      const nearestPicked = Math.min(
        ...selected.map((picked) => distance(candidate, picked)),
      );
      const score =
        nearestPicked * 3 +
        candidate.localOpportunity * 120 +
        candidate.resourceRichness * 40 +
        rng() * 55;
      if (best === null || score > best.score) {
        best = { candidate, score };
      }
    }
    if (best === null) break;
    selected.push(best.candidate);
  }

  return selected;
}

function shuffledKeys(keys: readonly string[], seed: string): string[] {
  const rng = createSeededRng(seed);
  const out = [...keys];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = out[i]!;
    out[i] = out[j]!;
    out[j] = tmp;
  }
  return out;
}

function shuffledCandidates(
  candidates: readonly ScoredCandidate[],
  rng: () => number,
): ScoredCandidate[] {
  const out = [...candidates];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = out[i]!;
    out[i] = out[j]!;
    out[j] = tmp;
  }
  return out;
}

export function chooseBalancedHomeworldPlacement(params: {
  systems: readonly HomeworldPlacementSystem[];
  count: number;
  seed: string;
}): BalancedHomeworldPlacement {
  if (params.count < 0) {
    throw new Error("Homeworld placement count cannot be negative.");
  }
  if (params.count === 0) {
    return {
      homeworldKeys: [],
      minNearestDistance: 0,
      nearestDistanceSpread: 0,
      localOpportunitySpread: 0,
    };
  }
  if (params.count > params.systems.length) {
    throw new Error(
      `Cannot place ${params.count} homeworlds on ${params.systems.length} systems.`,
    );
  }

  const candidates = buildScoredCandidates(params.systems);
  const rng = createSeededRng(`${params.seed}:homeworld-placement`);
  const attempts = Math.max(192, params.count * 96);
  type BestSelection = ReturnType<typeof scoreSelection> & {
    selected: ScoredCandidate[];
  };
  let best:
    | BestSelection
    | null = null;

  function betterOf(
    current: BestSelection | null,
    selected: ScoredCandidate[],
  ): BestSelection | null {
    if (selected.length !== params.count) return current;
    const scored = scoreSelection(selected);
    if (current === null || scored.score > current.score) {
      return { ...scored, selected };
    }
    return current;
  }

  for (let attempt = 0; attempt < attempts; attempt++) {
    best = betterOf(best, pickGreedySelection(candidates, params.count, rng));
    best = betterOf(best, shuffledCandidates(candidates, rng).slice(0, params.count));
  }

  if (best === null) {
    throw new Error("Unable to choose balanced homeworld placement.");
  }

  return {
    homeworldKeys: shuffledKeys(
      best.selected.map((s) => s.key),
      `${params.seed}:homeworld-assignment`,
    ),
    minNearestDistance: best.minNearestDistance,
    nearestDistanceSpread: best.nearestDistanceSpread,
    localOpportunitySpread: best.localOpportunitySpread,
  };
}
