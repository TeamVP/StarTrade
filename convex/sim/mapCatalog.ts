export type MapTier = "small" | "medium" | "large";

export type MapCatalogRow = {
  key: string;
  name: string;
  description: string;
  tier: MapTier;
  sortOrder: number;
  definitionJson?: string | null;
};

export type MapDefinition = {
  kind: "seeded_layout";
  generator:
    | "seedV1TwentyMap"
    | "seedV1MediumMap"
    | "runFullSpiralSeed"
    | "seedLegacyV1Core";
  systemCount: number;
  laneModel: "balanced" | "proximity" | "spiral" | "scaled_core";
  notes: string;
  scale?: number;
};

function mapDefinitionJson(definition: MapDefinition): string {
  return JSON.stringify(definition);
}

export const BUILT_IN_MAP_CATALOG_ROWS = [
  {
    key: "v1-twenty",
    name: "Twenty Worlds",
    description: "Balanced 20-system mission map.",
    tier: "small",
    sortOrder: 10,
    definitionJson: mapDefinitionJson({
      kind: "seeded_layout",
      generator: "seedV1TwentyMap",
      systemCount: 20,
      laneModel: "balanced",
      notes: "Balanced 20-system mission map with seeded homeworld placement.",
    }),
  },
  {
    key: "v1-medium",
    name: "Medium Cluster",
    description: "Expanded mission map with a medium-sized layout.",
    tier: "medium",
    sortOrder: 20,
    definitionJson: mapDefinitionJson({
      kind: "seeded_layout",
      generator: "seedV1MediumMap",
      systemCount: 120,
      laneModel: "proximity",
      notes: "Expanded medium cluster built from proximity lanes and balanced homeworld placement.",
    }),
  },
  {
    key: "v1-spiral",
    name: "Spiral Cluster",
    description: "Large spiral mission map for long-form scenarios.",
    tier: "large",
    sortOrder: 30,
    definitionJson: mapDefinitionJson({
      kind: "seeded_layout",
      generator: "runFullSpiralSeed",
      systemCount: 200,
      laneModel: "spiral",
      notes: "Large spiral mission map seeded in a background action.",
    }),
  },
  {
    key: "v1-large",
    name: "Legacy Core XL",
    description: "Scaled version of the legacy core mission map.",
    tier: "large",
    sortOrder: 40,
    definitionJson: mapDefinitionJson({
      kind: "seeded_layout",
      generator: "seedLegacyV1Core",
      systemCount: 3,
      laneModel: "scaled_core",
      scale: 2,
      notes: "Scaled version of the legacy tutorial core map.",
    }),
  },
] satisfies MapCatalogRow[];

BUILT_IN_MAP_CATALOG_ROWS.sort((left, right) => left.sortOrder - right.sortOrder);
