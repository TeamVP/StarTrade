/**
 * Per-empire strategic posture: five discrete levels per axis, merged from
 * strategy-derived defaults and optional player overrides in `emp_states`.
 */

/** Mirrors Priority star automation in `applyNpcStrategy` / strategy JSON. */
export type PriorityStarPolicy = {
  enabled: boolean;
  neutralDispatchPct: number;
  stagingDispatchPct: number;
  enemyDispatchPct: number;
  approachDispatchPct: number;
  enemyAttackAdvantageRequired?: number;
  minDefenseAverageFleetMult: number;
  shipBoostPct: number;
  minFoodStockpileTurns: number;
  /**
   * Maintain standing orders along the shortest owned-only path toward the nearest
   * reachable **owned** marked Priority star (rewritten each strategy pass when Priority stars move).
   */
  ownedCorridorStandingOrdersEnabled: boolean;
  ownedCorridorDispatchPct: number;
};

export const STRATEGIC_LEVELS = [
  "lowest",
  "low",
  "medium",
  "high",
  "highest",
] as const;

export type StrategicLevel = (typeof STRATEGIC_LEVELS)[number];

export type StrategicSliderKey =
  | "militaryAggression"
  | "expansion"
  | "defensivePosture"
  | "priorityOperations"
  | "economicMobilization";

export type StrategicSlidersResolved = Record<StrategicSliderKey, StrategicLevel>;

export type StrategicSliderOverrides = Partial<StrategicSlidersResolved>;

const SLIDER_KEYS: StrategicSliderKey[] = [
  "militaryAggression",
  "expansion",
  "defensivePosture",
  "priorityOperations",
  "economicMobilization",
];

export const STRATEGIC_SLIDER_LABELS: Record<StrategicSliderKey, string> = {
  militaryAggression: "Military aggression",
  expansion: "Expansion & colonization",
  defensivePosture: "Defense & reinforcement",
  priorityOperations: "Priority star operations",
  economicMobilization: "Economic mobilization",
};

export function isStrategicLevel(value: string): value is StrategicLevel {
  return (STRATEGIC_LEVELS as readonly string[]).includes(value);
}

function levelIndex(level: StrategicLevel): number {
  return STRATEGIC_LEVELS.indexOf(level);
}

/** Interpolate between a and b over the five positions (lowest→highest). */
function lerpLevels(level: StrategicLevel, a: number, b: number): number {
  const t = levelIndex(level) / 4;
  return a + (b - a) * t;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

type BorderStance =
  | "passive"
  | "defensive"
  | "balanced"
  | "aggressive"
  | "warlike";

function stanceToMilitaryDefault(stance: BorderStance): StrategicLevel {
  switch (stance) {
    case "passive":
      return "lowest";
    case "defensive":
      return "low";
    case "balanced":
      return "medium";
    case "aggressive":
      return "high";
    case "warlike":
      return "highest";
  }
}

/**
 * Derives baseline slider positions from the parsed automation strategy (no overrides).
 */
export function computeStrategicSliderDefaults(automation: {
  earlyRush: boolean;
  reserveShipsPct: number;
  priorityStarPolicy: { enabled: boolean; shipBoostPct: number };
  reinforceAttackedSystems: boolean;
  emergencyReserveShipsPct: number;
  stance: BorderStance;
}): StrategicSlidersResolved {
  const militaryAggression = stanceToMilitaryDefault(automation.stance);

  let expansion: StrategicLevel;
  if (!automation.earlyRush) {
    expansion = "low";
  } else {
    const r = automation.reserveShipsPct;
    if (r >= 45) expansion = "low";
    else if (r >= 35) expansion = "medium";
    else if (r >= 22) expansion = "high";
    else expansion = "highest";
  }

  let defensivePosture: StrategicLevel;
  if (!automation.reinforceAttackedSystems) {
    defensivePosture = "low";
  } else {
    const e = automation.emergencyReserveShipsPct;
    if (e >= 42) defensivePosture = "medium";
    else if (e >= 30) defensivePosture = "high";
    else defensivePosture = "highest";
  }

  const priorityOperations: StrategicLevel = automation.priorityStarPolicy.enabled
    ? "medium"
    : "low";

  let economicMobilization: StrategicLevel;
  const b = automation.priorityStarPolicy.shipBoostPct;
  if (b <= 0) economicMobilization = "low";
  else if (b < 8) economicMobilization = "medium";
  else if (b < 18) economicMobilization = "high";
  else economicMobilization = "highest";

  return {
    militaryAggression,
    expansion,
    defensivePosture,
    priorityOperations,
    economicMobilization,
  };
}

export function resolveStrategicSliders(
  defaults: StrategicSlidersResolved,
  overrides: StrategicSliderOverrides | undefined,
): StrategicSlidersResolved {
  const out = { ...defaults };
  if (overrides === undefined) return out;
  for (const key of SLIDER_KEYS) {
    const v = overrides[key];
    if (v !== undefined) {
      out[key] = v;
    }
  }
  return out;
}

/** Automation bundle adjusted for route generation and Priority star ship boost. */
export type RuntimeStrategyAutomation = {
  attackAdvantageRequired: number;
  reserveShipsPct: number;
  emergencyReserveShipsPct: number;
  reinforceBorderReservePct: number;
  enemyAttackBorderReservePct: number;
  priorityStarPolicy: PriorityStarPolicy;
};

/**
 * Builds an effective automation snapshot from parsed strategy automation and
 * resolved slider levels.
 */
export function buildRuntimeStrategyAutomation(params: {
  automation: {
    attackAdvantageRequired: number;
    reserveShipsPct: number;
    emergencyReserveShipsPct: number;
    borderReserveShipsPct: number;
    priorityStarPolicy: PriorityStarPolicy;
  };
  sliders: StrategicSlidersResolved;
}): RuntimeStrategyAutomation {
  const { automation, sliders } = params;
  const mil = sliders.militaryAggression;
  const exp = sliders.expansion;
  const def = sliders.defensivePosture;
  const priority = sliders.priorityOperations;
  const eco = sliders.economicMobilization;

  // More military aggression → lower advantage ratio required, lower reserve kept on border attacks.
  const attackAdvantageRequired = clamp(
    automation.attackAdvantageRequired / lerpLevels(mil, 0.82, 1.22),
    0.5,
    999,
  );

  const baseBr = clamp(automation.borderReserveShipsPct, 5, 95);
  // Interior → border movement: higher defensive posture → less kept in transit (more flows to border).
  const reinforceBorderReservePct = clamp(
    baseBr * lerpLevels(def, 1.14, 0.78),
    5,
    92,
  );
  // Attacks: higher military aggression → less reserve (more committed).
  const enemyAttackBorderReservePct = clamp(
    baseBr * lerpLevels(mil, 1.12, 0.76),
    5,
    92,
  );

  // Expansion: higher → lower empire-wide reserve (more early rush committed).
  const reserveShipsPct = clamp(
    automation.reserveShipsPct * lerpLevels(exp, 1.12, 0.82),
    5,
    95,
  );

  // Defense: higher reactive posture → send a larger share toward emergencies (lower % kept as “emergency reserve”).
  const emergencyReserveShipsPct = clamp(
    automation.emergencyReserveShipsPct * lerpLevels(def, 1.18, 0.72),
    0,
    95,
  );

  const priorityStarPolicyRaw = automation.priorityStarPolicy;
  const priorityDispatchMultiplier = lerpLevels(priority, 0.82, 1.2);
  const priorityBoostMultiplier =
    lerpLevels(priority, 0.75, 1.25) * lerpLevels(eco, 0.85, 1.18);

  const priorityStarPolicy: PriorityStarPolicy = {
    ...priorityStarPolicyRaw,
    neutralDispatchPct: clamp(
      Math.round(priorityStarPolicyRaw.neutralDispatchPct * priorityDispatchMultiplier),
      1,
      100,
    ),
    stagingDispatchPct: clamp(
      Math.round(priorityStarPolicyRaw.stagingDispatchPct * priorityDispatchMultiplier),
      1,
      100,
    ),
    enemyDispatchPct: clamp(
      Math.round(priorityStarPolicyRaw.enemyDispatchPct * priorityDispatchMultiplier),
      1,
      100,
    ),
    approachDispatchPct: clamp(
      Math.round(priorityStarPolicyRaw.approachDispatchPct * priorityDispatchMultiplier),
      1,
      100,
    ),
    ownedCorridorDispatchPct: clamp(
      Math.round(
        priorityStarPolicyRaw.ownedCorridorDispatchPct * priorityDispatchMultiplier,
      ),
      1,
      100,
    ),
    minDefenseAverageFleetMult: clamp(
      priorityStarPolicyRaw.minDefenseAverageFleetMult * lerpLevels(priority, 0.88, 1.15),
      0,
      5,
    ),
    shipBoostPct: clamp(
      Math.round(priorityStarPolicyRaw.shipBoostPct * priorityBoostMultiplier),
      0,
      100,
    ),
  };

  return {
    attackAdvantageRequired,
    reserveShipsPct,
    emergencyReserveShipsPct,
    reinforceBorderReservePct,
    enemyAttackBorderReservePct,
    priorityStarPolicy,
  };
}
