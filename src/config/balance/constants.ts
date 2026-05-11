export const BALANCE = {
  turnDurationMs: 15_000,
  defenderMultiplier: 2,
  taxPerPopulation: 0.7,
  starvationFactor: 0.06,
  homeworldBonus: 1.15,
  collateralDamageChance: 0.45,
} as const;

export type BalanceConfig = typeof BALANCE;
