export const DEFENDER_BASE_MULTIPLIER = 2;
export const HOMEWORLD_DEFENSE_MULTIPLIER = 1.15;
export const COMBAT_LOSS_FACTOR = 0.08;
export const COLLATERAL_DAMAGE_CHANCE = 0.45;
export const MIN_COLLATERAL_DAMAGE_PCT = 0.05;
export const MAX_COLLATERAL_DAMAGE_PCT = 0.2;
export const HOMEWORLD_COLLATERAL_RESISTANCE = 0.8;
export const MAX_COMBAT_ROUNDS = 64;

export type BattleSide = {
  empireId: string;
  ships: number;
};

export type CollateralState = {
  stockFood: number;
  stockWeapons: number;
  stockResearch: number;
  population: number;
};

export type DamageCategory = keyof CollateralState;

export type BattleRoundResult = {
  phase: "opening" | "full";
  roundNumber: number;
  attackerShipsBefore: number;
  defenderShipsBefore: number;
  attackerLosses: number;
  defenderLosses: number;
  attackerShipsAfter: number;
  defenderShipsAfter: number;
};

export type CollateralDamageResult = {
  roundNumber: number;
  category: DamageCategory;
  roll: number;
  damagePct: number;
  amount: number;
  before: number;
  after: number;
};

export type BattleResolution = {
  winnerEmpireId: string | null;
  attackerShipsRemaining: number;
  defenderShipsRemaining: number;
  rounds: BattleRoundResult[];
  collateral: CollateralDamageResult[];
  collateralState: CollateralState;
};

export type ResolveBattleInput = {
  attacker: BattleSide;
  defender: BattleSide;
  seed: string;
  systemId: string;
  turnNumber: number;
  isDefenderHomeworld: boolean;
  collateralState: CollateralState;
};

const DAMAGE_WEIGHTS: Array<{ category: DamageCategory; weight: number }> = [
  { category: "stockFood", weight: 0.35 },
  { category: "stockWeapons", weight: 0.2 },
  { category: "stockResearch", weight: 0.15 },
  { category: "population", weight: 0.3 },
];

function hashString(input: string): number {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function createSeededRng(seed: string): () => number {
  let state = hashString(seed);
  return () => {
    state += 0x6d2b79f5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function defenderMultiplier(isDefenderHomeworld: boolean): number {
  return (
    DEFENDER_BASE_MULTIPLIER *
    (isDefenderHomeworld ? HOMEWORLD_DEFENSE_MULTIPLIER : 1)
  );
}

function clampLosses(losses: number, ships: number): number {
  return Math.max(0, Math.min(ships, losses));
}

/**
 * Returns a copy of DAMAGE_WEIGHTS with the `stockFood` entry scaled by `foodMult`,
 * then all weights renormalised to sum to 1.0.
 * foodMult = 0 → food is immune; foodMult > 1 → food takes a larger share.
 */
function scaledDamageWeights(
  foodMult: number,
): Array<{ category: DamageCategory; weight: number }> {
  const scaled = DAMAGE_WEIGHTS.map((w) => ({
    category: w.category,
    weight: w.category === "stockFood" ? w.weight * Math.max(0, foodMult) : w.weight,
  }));
  const total = scaled.reduce((sum, w) => sum + w.weight, 0);
  if (total <= 0) {
    // All weights collapsed to zero — fall back to uniform across non-food categories.
    const nonFood = DAMAGE_WEIGHTS.filter((w) => w.category !== "stockFood");
    const uniform = 1 / nonFood.length;
    return nonFood.map((w) => ({ category: w.category, weight: uniform }));
  }
  return scaled.map((w) => ({ ...w, weight: w.weight / total }));
}

function chooseDamageCategory(
  roll: number,
  weights: Array<{ category: DamageCategory; weight: number }> = DAMAGE_WEIGHTS,
): DamageCategory {
  let cursor = 0;
  for (const candidate of weights) {
    cursor += candidate.weight;
    if (roll <= cursor) return candidate.category;
  }
  return weights[weights.length - 1]?.category ?? "population";
}

function applyCollateralDamage(params: {
  roundNumber: number;
  rng: () => number;
  state: CollateralState;
  isDefenderHomeworld: boolean;
  chanceOverride?: number;
  /** Scales the relative probability that collateral lands on stockFood (default 1.0). */
  foodDamageMult?: number;
}): CollateralDamageResult | null {
  const chance = params.chanceOverride ?? COLLATERAL_DAMAGE_CHANCE;
  const roll = params.rng();
  if (roll >= chance) return null;

  const weights =
    params.foodDamageMult !== undefined && params.foodDamageMult !== 1
      ? scaledDamageWeights(params.foodDamageMult)
      : DAMAGE_WEIGHTS;
  const category = chooseDamageCategory(params.rng(), weights);
  const basePct =
    MIN_COLLATERAL_DAMAGE_PCT +
    params.rng() * (MAX_COLLATERAL_DAMAGE_PCT - MIN_COLLATERAL_DAMAGE_PCT);
  const damagePct =
    basePct * (params.isDefenderHomeworld ? HOMEWORLD_COLLATERAL_RESISTANCE : 1);
  const before = Math.max(0, params.state[category]);
  const amount = Math.min(before, Math.ceil(before * damagePct));
  const after = before - amount;
  params.state[category] = after;

  if (amount <= 0) return null;
  return {
    roundNumber: params.roundNumber,
    category,
    roll,
    damagePct,
    amount,
    before,
    after,
  };
}

/** Optional god-mode multipliers passed from the turn engine. All default to 1. */
export type CombatMultipliers = {
  attackMult?: number;
  defendMult?: number;
  collateralDamageMult?: number;
  /** Scales relative probability that collateral hits food stockpiles. */
  foodDamageMult?: number;
};

export function resolveOpeningStrike(input: {
  attackerShips: number;
  defenderShips: number;
  isDefenderHomeworld: boolean;
  multipliers?: CombatMultipliers;
}): BattleRoundResult {
  const attackMult = input.multipliers?.attackMult ?? 1;
  const defendMult = input.multipliers?.defendMult ?? 1;
  const attackerShipsBefore = Math.max(0, Math.floor(input.attackerShips));
  const defenderShipsBefore = Math.max(0, Math.floor(input.defenderShips));
  const attackerLosses = clampLosses(
    Math.ceil(
      defenderShipsBefore *
        defenderMultiplier(input.isDefenderHomeworld) *
        defendMult *
        COMBAT_LOSS_FACTOR *
        0.5,
    ),
    attackerShipsBefore,
  );
  // Attacker's opening fire is suppressed by defenders (no attacker losses for defenders here).
  void attackMult;

  return {
    phase: "opening",
    roundNumber: 0,
    attackerShipsBefore,
    defenderShipsBefore,
    attackerLosses,
    defenderLosses: 0,
    attackerShipsAfter: attackerShipsBefore - attackerLosses,
    defenderShipsAfter: defenderShipsBefore,
  };
}

export function resolveFullCombatRound(input: {
  attackerShips: number;
  defenderShips: number;
  seed: string;
  systemId: string;
  turnNumber: number;
  attackerEmpireId: string;
  defenderEmpireId: string;
  roundNumber: number;
  isDefenderHomeworld: boolean;
  collateralState: CollateralState;
  multipliers?: CombatMultipliers;
}): {
  round: BattleRoundResult;
  collateral: CollateralDamageResult[];
  collateralState: CollateralState;
} {
  const attackMult = input.multipliers?.attackMult ?? 1;
  const defendMult = input.multipliers?.defendMult ?? 1;
  const collateralMult = input.multipliers?.collateralDamageMult ?? 1;

  const attackerShipsBefore = Math.max(0, Math.floor(input.attackerShips));
  const defenderShipsBefore = Math.max(0, Math.floor(input.defenderShips));
  const defenseMultiplier = defenderMultiplier(input.isDefenderHomeworld);
  const attackerLosses = clampLosses(
    Math.ceil(defenderShipsBefore * defenseMultiplier * defendMult * COMBAT_LOSS_FACTOR),
    attackerShipsBefore,
  );
  const defenderLosses = clampLosses(
    Math.ceil(attackerShipsBefore * attackMult * COMBAT_LOSS_FACTOR),
    defenderShipsBefore,
  );
  const collateralState: CollateralState = { ...input.collateralState };
  const rng = createSeededRng(
    `${input.seed}:${input.turnNumber}:${input.systemId}:${input.attackerEmpireId}:${input.defenderEmpireId}:${input.roundNumber}`,
  );

  // Scale collateral by applying the multiplier to the damage chance roll.
  // collateralMult > 1 → more damage; 0 → no collateral damage.
  const scaledChance = Math.min(1, COLLATERAL_DAMAGE_CHANCE * collateralMult);
  const damage = applyCollateralDamage({
    roundNumber: input.roundNumber,
    rng,
    state: collateralState,
    isDefenderHomeworld: input.isDefenderHomeworld,
    chanceOverride: scaledChance,
    foodDamageMult: input.multipliers?.foodDamageMult,
  });

  return {
    round: {
      phase: "full",
      roundNumber: input.roundNumber,
      attackerShipsBefore,
      defenderShipsBefore,
      attackerLosses,
      defenderLosses,
      attackerShipsAfter: attackerShipsBefore - attackerLosses,
      defenderShipsAfter: defenderShipsBefore - defenderLosses,
    },
    collateral: damage === null ? [] : [damage],
    collateralState,
  };
}

export function resolveTwoEmpireBattle(input: ResolveBattleInput): BattleResolution {
  let attackerShips = Math.max(0, Math.floor(input.attacker.ships));
  let defenderShips = Math.max(0, Math.floor(input.defender.ships));
  const rounds: BattleRoundResult[] = [];
  const collateral: CollateralDamageResult[] = [];
  const collateralState: CollateralState = { ...input.collateralState };

  if (attackerShips > 0 && defenderShips > 0) {
    const opening = resolveOpeningStrike({
      attackerShips,
      defenderShips,
      isDefenderHomeworld: input.isDefenderHomeworld,
    });
    attackerShips = opening.attackerShipsAfter;
    rounds.push(opening);
  }

  let roundNumber = 1;
  while (
    attackerShips > 0 &&
    defenderShips > 0 &&
    roundNumber <= MAX_COMBAT_ROUNDS
  ) {
    const fullRound = resolveFullCombatRound({
      attackerShips,
      defenderShips,
      seed: input.seed,
      systemId: input.systemId,
      turnNumber: input.turnNumber,
      attackerEmpireId: input.attacker.empireId,
      defenderEmpireId: input.defender.empireId,
      roundNumber,
      isDefenderHomeworld: input.isDefenderHomeworld,
      collateralState,
    });
    attackerShips = fullRound.round.attackerShipsAfter;
    defenderShips = fullRound.round.defenderShipsAfter;
    rounds.push(fullRound.round);
    collateralState.stockFood = fullRound.collateralState.stockFood;
    collateralState.stockWeapons = fullRound.collateralState.stockWeapons;
    collateralState.stockResearch = fullRound.collateralState.stockResearch;
    collateralState.population = fullRound.collateralState.population;
    collateral.push(...fullRound.collateral);
    roundNumber += 1;
  }

  const winnerEmpireId =
    attackerShips > 0 && defenderShips <= 0
      ? input.attacker.empireId
      : defenderShips > 0
        ? input.defender.empireId
        : null;

  return {
    winnerEmpireId,
    attackerShipsRemaining: attackerShips,
    defenderShipsRemaining: defenderShips,
    rounds,
    collateral,
    collateralState,
  };
}
