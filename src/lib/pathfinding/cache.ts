type Edge = {
  from: string;
  to: string;
  distance: number;
};

export function buildAdjacency(edges: Edge[]) {
  const adjacency: Record<string, Array<{ to: string; distance: number }>> = {};
  for (const edge of edges) {
    adjacency[edge.from] ??= [];
    adjacency[edge.from].push({ to: edge.to, distance: edge.distance });
  }
  return adjacency;
}
