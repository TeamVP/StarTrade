import { buildProximityLanes } from "./proximityLanes";

/** Euclidean divisor tuned so legacy α–γ spacing (~289px) rounds to distance 7 at scale 41. */
export const V1_TWENTY_LINK_DISTANCE_SCALE = 41;

export type V1TwentyStartingOwner = "neutral" | "aurora" | "iron";

export type V1TwentySeedSystem = {
  key: string;
  name: string;
  x: number;
  y: number;
  resourceRichness: number;
  isHomeworld: boolean;
  startingOwner: V1TwentyStartingOwner;
};

export type V1TwentyLaneKey = { fromKey: string; toKey: string };

export function makeLinkMetrics(
  ax: number,
  ay: number,
  bx: number,
  by: number,
): { distance: number; travelCost: number } {
  const d = Math.hypot(ax - bx, ay - by);
  const distance = Math.max(1, Math.round(d / V1_TWENTY_LINK_DISTANCE_SCALE));
  return { distance, travelCost: distance * 2 };
}

/** Twenty systems — coords fit 760×520 Pixi stage with margin for orbit rings. */
export const V1_TWENTY_SYSTEMS: V1TwentySeedSystem[] = [
  {
    key: "luminara-deep",
    name: "Luminara Deep (Aurora Throne)",
    x: 90,
    y: 200,
    resourceRichness: 0.82,
    isHomeworld: true,
    startingOwner: "aurora",
  },
  {
    key: "ashforge-terminal",
    name: "Ashforge Terminal",
    x: 670,
    y: 280,
    resourceRichness: 0.71,
    isHomeworld: true,
    startingOwner: "iron",
  },
  {
    key: "veilcrest-station",
    name: "Veilcrest Station",
    x: 140,
    y: 90,
    resourceRichness: 0.44,
    isHomeworld: false,
    startingOwner: "neutral",
  },
  {
    key: "cobalt-shallows",
    name: "Cobalt Shallows",
    x: 200,
    y: 155,
    resourceRichness: 0.37,
    isHomeworld: false,
    startingOwner: "neutral",
  },
  {
    key: "whisper-barrier",
    name: "Whisper Barrier",
    x: 280,
    y: 115,
    resourceRichness: 0.53,
    isHomeworld: false,
    startingOwner: "neutral",
  },
  {
    key: "kepler-rift",
    name: "Kepler Rift Survey Band",
    x: 340,
    y: 180,
    resourceRichness: 0.68,
    isHomeworld: false,
    startingOwner: "neutral",
  },
  {
    key: "sapphire-minor",
    name: "Sapphire Minor",
    x: 420,
    y: 95,
    resourceRichness: 0.42,
    isHomeworld: false,
    startingOwner: "neutral",
  },
  {
    key: "echo-verge",
    name: "Echo Verge Relay",
    x: 520,
    y: 140,
    resourceRichness: 0.28,
    isHomeworld: false,
    startingOwner: "neutral",
  },
  {
    key: "rust-canal",
    name: "Rust Canal Yards",
    x: 620,
    y: 170,
    resourceRichness: 0.59,
    isHomeworld: false,
    startingOwner: "neutral",
  },
  {
    key: "obsidian-gate",
    name: "Obsidian Gate",
    x: 580,
    y: 240,
    resourceRichness: 0.64,
    isHomeworld: false,
    startingOwner: "neutral",
  },
  {
    key: "solar-quarry",
    name: "Solar Quarry Works",
    x: 480,
    y: 260,
    resourceRichness: 0.89,
    isHomeworld: false,
    startingOwner: "neutral",
  },
  {
    key: "twin-pulse",
    name: "Twin Pulse / Inner Roche",
    x: 380,
    y: 280,
    resourceRichness: 0.56,
    isHomeworld: false,
    startingOwner: "neutral",
  },
  {
    key: "mirage-coil",
    name: "Mirage Coil",
    x: 290,
    y: 260,
    resourceRichness: 0.31,
    isHomeworld: false,
    startingOwner: "neutral",
  },
  {
    key: "frost-jacket",
    name: "Frost Jacket Ice Belt",
    x: 185,
    y: 245,
    resourceRichness: 0.21,
    isHomeworld: false,
    startingOwner: "neutral",
  },
  {
    key: "helix-run",
    name: "Helix Run Drift",
    x: 115,
    y: 310,
    resourceRichness: 0.46,
    isHomeworld: false,
    startingOwner: "neutral",
  },
  {
    key: "amber-regency",
    name: "Amber Regency Agri-Ring",
    x: 245,
    y: 340,
    resourceRichness: 0.75,
    isHomeworld: false,
    startingOwner: "neutral",
  },
  {
    key: "void-narthex",
    name: "Void Narthex",
    x: 375,
    y: 380,
    resourceRichness: 0.18,
    isHomeworld: false,
    startingOwner: "neutral",
  },
  {
    key: "cascade-point",
    name: "Cascade Point Drydock",
    x: 505,
    y: 360,
    resourceRichness: 0.62,
    isHomeworld: false,
    startingOwner: "neutral",
  },
  {
    key: "iron-kettle",
    name: "Iron Kettle Nebula Outpost",
    x: 615,
    y: 380,
    resourceRichness: 0.77,
    isHomeworld: false,
    startingOwner: "neutral",
  },
  {
    key: "pilgrim-rest",
    name: "Pilgrim's Rest Bazaar",
    x: 660,
    y: 420,
    resourceRichness: 0.43,
    isHomeworld: false,
    startingOwner: "neutral",
  },
];

/**
 * Hyperlanes built with the proximity algorithm:
 * MST guarantees full connectivity; k-nearest additions keep 90%+ of
 * routes between geographically close stars.
 *
 * Parameters tuned for the 760×520 twenty-star viewport:
 *   maxAddLaneDistance=200  keeps additions within ~30% of the map diagonal
 *   kNearest=3              up to 3 local shortcuts per star beyond MST
 *   maxDegree=5             no star becomes an overwhelming hub
 */
export const V1_TWENTY_LANE_KEYS: V1TwentyLaneKey[] = buildProximityLanes(
  V1_TWENTY_SYSTEMS,
  { kNearest: 3, maxAddLaneDistance: 200, maxDegree: 5 },
);
