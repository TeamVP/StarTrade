import { DEFAULT_TURN_DURATION_MS } from "../../../convex/sim/turnTiming";

export const BALANCE = {
  turnDurationMs: DEFAULT_TURN_DURATION_MS,
  defenderMultiplier: 2,
  taxPerPopulation: 0.7,
  starvationFactor: 0.06,
  homeworldBonus: 1.15,
  collateralDamageChance: 0.45,
} as const;

export type BalanceConfig = typeof BALANCE;
