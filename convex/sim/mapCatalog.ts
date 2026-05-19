import { V1_TWENTY_LANE_KEYS, V1_TWENTY_SYSTEMS, makeLinkMetrics } from "../seed/v1Twenty";
import { V1_MEDIUM_LANE_KEYS, V1_MEDIUM_SYSTEMS, makeMediumLinkMetrics } from "../seed/v1Medium";
import {
  V1_SPIRAL_LANE_KEYS,
  V1_SPIRAL_SYSTEMS,
  V1_SPIRAL_WORLD_HEIGHT,
  V1_SPIRAL_WORLD_WIDTH,
  makeSpiralLinkMetrics,
} from "../seed/v1Spiral";

export type MapTier = "small" | "medium" | "large";

export type MapStartingOwner = "neutral" | "aurora" | "iron";

export type MapTopologySystem = {
  key: string;
  name: string;
  x: number;
  y: number;
  resourceRichness: number;
  isHomeworld: boolean;
  startingOwner: MapStartingOwner;
};

export type MapTopologyRoute = {
  fromKey: string;
  toKey: string;
  distance: number;
  travelCost: number;
};

export type MapTopologyDefinition = {
  kind: "seeded_layout";
  width: number;
  height: number;
  systems: MapTopologySystem[];
  routes: MapTopologyRoute[];
};

export type MapCatalogRow = {
  key: string;
  name: string;
  description: string;
  tier: MapTier;
  sortOrder: number;
  definition?: MapTopologyDefinition | null;
  definitionJson?: string | null;
};

type MapTopologyRouteKey = { fromKey: string; toKey: string };

function serializeDefinition(definition: MapTopologyDefinition): string {
  return JSON.stringify(definition, null, 2);
}

function toSystemMap(systems: readonly MapTopologySystem[]): Map<string, MapTopologySystem> {
  return new Map(systems.map((system) => [system.key, system]));
}

function toRoutes(
  routes: readonly MapTopologyRouteKey[],
  systems: readonly MapTopologySystem[],
  metric: (ax: number, ay: number, bx: number, by: number) => { distance: number; travelCost: number },
): MapTopologyRoute[] {
  const byKey = toSystemMap(systems);
  return routes.flatMap((route) => {
    const from = byKey.get(route.fromKey);
    const to = byKey.get(route.toKey);
    if (from === undefined || to === undefined) {
      return [];
    }
    const metrics = metric(from.x, from.y, to.x, to.y);
    return [{ ...route, distance: metrics.distance, travelCost: metrics.travelCost }];
  });
}

function buildTopologyDefinition(params: {
  width: number;
  height: number;
  systems: readonly MapTopologySystem[];
  routes: readonly MapTopologyRouteKey[];
  metric: (ax: number, ay: number, bx: number, by: number) => { distance: number; travelCost: number };
}): MapTopologyDefinition {
  const definition = {
    kind: "seeded_layout" as const,
    width: params.width,
    height: params.height,
    systems: [...params.systems],
    routes: toRoutes(params.routes, params.systems, params.metric),
  };
  return definition;
}

const V1_CORE_TOPOLOGY: MapTopologyDefinition = {
  kind: "seeded_layout",
  width: 900,
  height: 900,
  systems: [
    { key: "alpha", name: "Alpha Prime", x: 120, y: 160, resourceRichness: 0.8, isHomeworld: true, startingOwner: "aurora" },
    { key: "beta", name: "Beta Reach", x: 420, y: 260, resourceRichness: 0.6, isHomeworld: true, startingOwner: "iron" },
    { key: "gamma", name: "Gamma Drift", x: 260, y: 420, resourceRichness: 0.7, isHomeworld: false, startingOwner: "neutral" },
  ],
  routes: [
    { fromKey: "alpha", toKey: "gamma", distance: 7, travelCost: 14 },
    { fromKey: "gamma", toKey: "beta", distance: 6, travelCost: 12 },
  ],
};

const V1_TWENTY_TOPOLOGY = buildTopologyDefinition({
  width: 760,
  height: 520,
  systems: V1_TWENTY_SYSTEMS,
  routes: V1_TWENTY_LANE_KEYS,
  metric: makeLinkMetrics,
});

const V1_MEDIUM_TOPOLOGY = buildTopologyDefinition({
  width: 2100,
  height: 1200,
  systems: V1_MEDIUM_SYSTEMS,
  routes: V1_MEDIUM_LANE_KEYS,
  metric: makeMediumLinkMetrics,
});

const V1_SPIRAL_TOPOLOGY = buildTopologyDefinition({
  width: V1_SPIRAL_WORLD_WIDTH,
  height: V1_SPIRAL_WORLD_HEIGHT,
  systems: V1_SPIRAL_SYSTEMS,
  routes: V1_SPIRAL_LANE_KEYS,
  metric: makeSpiralLinkMetrics,
});

export const BUILT_IN_MAP_CATALOG_ROWS: MapCatalogRow[] = [
  {
    key: "v1-twenty",
    name: "Twenty Worlds",
    description: "Balanced 20-system mission map.",
    tier: "small",
    sortOrder: 10,
    definition: V1_TWENTY_TOPOLOGY,
    definitionJson: serializeDefinition(V1_TWENTY_TOPOLOGY),
  },
  {
    key: "v1-medium",
    name: "Medium Cluster",
    description: "Expanded mission map with a medium-sized layout.",
    tier: "medium",
    sortOrder: 20,
    definition: V1_MEDIUM_TOPOLOGY,
    definitionJson: serializeDefinition(V1_MEDIUM_TOPOLOGY),
  },
  {
    key: "v1-spiral",
    name: "Spiral Cluster",
    description: "Large spiral mission map for long-form scenarios.",
    tier: "large",
    sortOrder: 30,
    definition: V1_SPIRAL_TOPOLOGY,
    definitionJson: serializeDefinition(V1_SPIRAL_TOPOLOGY),
  },
  {
    key: "v1-large",
    name: "Legacy Core XL",
    description: "Scaled version of the legacy core mission map.",
    tier: "large",
    sortOrder: 40,
    definition: V1_CORE_TOPOLOGY,
    definitionJson: serializeDefinition(V1_CORE_TOPOLOGY),
  },
];

BUILT_IN_MAP_CATALOG_ROWS.sort((left, right) => left.sortOrder - right.sortOrder);
