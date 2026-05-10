export const BALANCE = {
  turnDurationMs: 15_000,
  defenderMultiplier: 1.2,
  taxPerPopulation: 0.7,
  starvationFactor: 0.06,
  homeworldBonus: 1.15,
  collateralDamageChance: 0.1,
} as const;

export type BalanceConfig = typeof BALANCE;
