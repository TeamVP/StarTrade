import { buildProximityLanes } from "./proximityLanes";

export const V1_MEDIUM_LINK_DISTANCE_SCALE = 72;

export type V1MediumStartingOwner = "neutral" | "aurora" | "iron";

export type V1MediumSeedSystem = {
  key: string;
  name: string;
  x: number;
  y: number;
  resourceRichness: number;
  isHomeworld: boolean;
  startingOwner: V1MediumStartingOwner;
};

export type V1MediumLaneKey = { fromKey: string; toKey: string };

type Sector = {
  key: string;
  label: string;
  centerX: number;
  centerY: number;
  radiusX: number;
  radiusY: number;
  baseRichness: number;
};

type Feature = {
  key: string;
  label: string;
  richnessDelta: number;
};

const SECTORS: Sector[] = [
  {
    key: "aurora",
    label: "Aurora Reach",
    centerX: 220,
    centerY: 520,
    radiusX: 210,
    radiusY: 175,
    baseRichness: 0.7,
  },
  {
    key: "veil",
    label: "Veilward March",
    centerX: 575,
    centerY: 245,
    radiusX: 235,
    radiusY: 170,
    baseRichness: 0.48,
  },
  {
    key: "core",
    label: "Crown Core",
    centerX: 975,
    centerY: 540,
    radiusX: 255,
    radiusY: 205,
    baseRichness: 0.61,
  },
  {
    key: "zenith",
    label: "Zenith Shelf",
    centerX: 1345,
    centerY: 270,
    radiusX: 230,
    radiusY: 165,
    baseRichness: 0.43,
  },
  {
    key: "forge",
    label: "Iron Verge",
    centerX: 1790,
    centerY: 620,
    radiusX: 245,
    radiusY: 190,
    baseRichness: 0.68,
  },
  {
    key: "rim",
    label: "Pilgrim Rim",
    centerX: 1120,
    centerY: 965,
    radiusX: 330,
    radiusY: 180,
    baseRichness: 0.39,
  },
];

const FEATURES: Feature[] = [
  { key: "crown", label: "Crown", richnessDelta: 0.08 },
  { key: "anvil", label: "Anvil", richnessDelta: 0.12 },
  { key: "orchard", label: "Orchard Belt", richnessDelta: 0.04 },
  { key: "lantern", label: "Lantern", richnessDelta: -0.03 },
  { key: "reef", label: "Crystal Reef", richnessDelta: 0.09 },
  { key: "gate", label: "Gate", richnessDelta: 0.01 },
  { key: "fathom", label: "Fathom", richnessDelta: -0.12 },
  { key: "quarry", label: "Quarry", richnessDelta: 0.17 },
  { key: "hospice", label: "Hospice", richnessDelta: -0.02 },
  { key: "spire", label: "Spire", richnessDelta: 0.03 },
  { key: "shoal", label: "Dust Shoal", richnessDelta: -0.08 },
  { key: "harbor", label: "Free Harbor", richnessDelta: 0.02 },
  { key: "cistern", label: "Ice Cistern", richnessDelta: -0.04 },
  { key: "foundry", label: "Foundry", richnessDelta: 0.14 },
  { key: "archive", label: "Archive Moon", richnessDelta: 0.0 },
  { key: "needle", label: "Needle", richnessDelta: -0.05 },
  { key: "bazaar", label: "Bazaar", richnessDelta: 0.05 },
  { key: "mirror", label: "Mirror", richnessDelta: -0.01 },
  { key: "warren", label: "Warren", richnessDelta: 0.07 },
  { key: "outer", label: "Outer Watch", richnessDelta: -0.1 },
];

function systemKey(sectorIndex: number, featureIndex: number): string {
  return `${SECTORS[sectorIndex].key}-${FEATURES[featureIndex].key}`;
}

function clampRichness(value: number): number {
  return Math.max(0.15, Math.min(0.95, Math.round(value * 100) / 100));
}

function systemName(
  sector: Sector,
  feature: Feature,
  featureIndex: number,
): string {
  if (sector.key === "aurora" && featureIndex === 0) {
    return "Luminara Deep (Aurora Throne)";
  }
  if (sector.key === "forge" && featureIndex === 0) {
    return "Ashforge Terminal";
  }
  return `${sector.label} ${feature.label}`;
}

function startingOwner(sectorKey: string, featureIndex: number): V1MediumStartingOwner {
  if (sectorKey === "aurora" && featureIndex === 0) return "aurora";
  if (sectorKey === "forge" && featureIndex === 0) return "iron";
  return "neutral";
}

function buildSystems(): V1MediumSeedSystem[] {
  const systems: V1MediumSeedSystem[] = [];
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));

  for (let sectorIndex = 0; sectorIndex < SECTORS.length; sectorIndex++) {
    const sector = SECTORS[sectorIndex];
    for (let featureIndex = 0; featureIndex < FEATURES.length; featureIndex++) {
      const feature = FEATURES[featureIndex];
      const spiralStep = featureIndex + 1;
      const ring = 0.32 + ((featureIndex % 5) / 4) * 0.68;
      const theta = spiralStep * goldenAngle + sectorIndex * 0.43;
      const wobble = ((sectorIndex * 17 + featureIndex * 29) % 23) - 11;
      const x = Math.round(sector.centerX + Math.cos(theta) * sector.radiusX * ring + wobble);
      const y = Math.round(
        sector.centerY + Math.sin(theta) * sector.radiusY * ring - wobble * 0.45,
      );
      const owner = startingOwner(sector.key, featureIndex);
      const jitter = (((sectorIndex * 7 + featureIndex * 11) % 13) - 6) / 100;

      systems.push({
        key: systemKey(sectorIndex, featureIndex),
        name: systemName(sector, feature, featureIndex),
        x,
        y,
        resourceRichness: clampRichness(
          sector.baseRichness + feature.richnessDelta + jitter,
        ),
        isHomeworld: owner !== "neutral",
        startingOwner: owner,
      });
    }
  }

  return systems;
}

/**
 * Build lanes using the proximity algorithm:
 * MST guarantees full galaxy connectivity across all sectors;
 * k-nearest additions keep 90%+ of routes between physically close stars.
 *
 * Parameters tuned for the medium galaxy world space (~2100×1200):
 *   maxAddLaneDistance=380  roughly one sector neighbourhood radius;
 *                           inter-sector gaps (~450-750px) are bridged
 *                           only by the MST's mandatory long-range edges
 *   kNearest=3              up to 3 local shortcuts per star beyond MST
 *   maxDegree=5             no star becomes an overwhelming hub
 */
function buildLanes(): V1MediumLaneKey[] {
  return buildProximityLanes(V1_MEDIUM_SYSTEMS, {
    kNearest: 3,
    maxAddLaneDistance: 380,
    maxDegree: 5,
  });
}

export function makeMediumLinkMetrics(
  ax: number,
  ay: number,
  bx: number,
  by: number,
): { distance: number; travelCost: number } {
  const d = Math.hypot(ax - bx, ay - by);
  const distance = Math.max(1, Math.round(d / V1_MEDIUM_LINK_DISTANCE_SCALE));
  return { distance, travelCost: distance * 2 };
}

export const V1_MEDIUM_SYSTEMS = buildSystems();
export const V1_MEDIUM_LANE_KEYS = buildLanes();
