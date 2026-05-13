/**
 * Canonical default god-mode multipliers and the loader that reads per-game overrides.
 * All multipliers default to 1.0 (no effect) when no settings row exists for a game.
 */

import type { Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import {
  BG_TRADER_AUTOMATED_INITIAL_MAX_ACTIVE,
  BG_TRADER_DOCKING_COST,
  BG_TRADER_HIRE_CHANCE_PCT,
  BG_TRADER_SHIP_HIRE_PER_TURN,
} from "./constants";

export type GameSettings = {
  foodProdMult: number;
  shipProdMult: number;
  popGrowthMult: number;
  taxMult: number;
  foodPriceElasticityMult: number;
  starvationMult: number;
  /** Upper bound on food price multiplier during starvation crises (× baseline price). */
  starvationFoodPriceCapMult: number;
  traderShipCostMult: number;
  combatAttackMult: number;
  combatDefendMult: number;
  collateralDamageMult: number;
  // ─── Balance page settings ─────────────────────────────────────────────────
  traderMinActive: number;
  traderMaxActive: number;
  traderShipHirePerTurn: number;
  /** Percent chance (0-100) that an NPC hires a ship after seeing a viable job. */
  traderHireChancePct: number;
  traderDockingCost: number;
  /** Multiple of one-turn demand above which market is in oversupply (default 20.0). */
  foodStockpileMaxPerPop: number;
  /** Multiple of one-turn demand below which food stress pricing activates (default 1.5). */
  foodStockpileMinPerPop: number;
  /** Multiplier on price growth rate when below minimum stockpile (default 1.0). */
  foodStressFactor: number;
  /** Defender advantage ratio replacing DEFENDER_BASE_MULTIPLIER (default 2.0). */
  combatDefenderAdvantage: number;
  /** Base food price per unit at equilibrium in whole credits (default 6). */
  foodBasePrice: number;
  /** Multiplier on the probability that collateral damage lands on food stockpiles (default 1.0). */
  combatFoodDamageMult: number;
  /** When true, min/max NPC trader limits are tuned by the sim from delivery economics. */
  traderLimitsAutomated: boolean;
};

export const DEFAULT_GAME_SETTINGS: GameSettings = {
  foodProdMult: 1,
  shipProdMult: 1,
  popGrowthMult: 1,
  taxMult: 1,
  foodPriceElasticityMult: 1,
  starvationMult: 1,
  starvationFoodPriceCapMult: 100,
  traderShipCostMult: 1,
  combatAttackMult: 1,
  combatDefendMult: 1,
  collateralDamageMult: 1,
  traderMinActive: 0,
  traderMaxActive: BG_TRADER_AUTOMATED_INITIAL_MAX_ACTIVE,
  traderShipHirePerTurn: BG_TRADER_SHIP_HIRE_PER_TURN,
  traderHireChancePct: BG_TRADER_HIRE_CHANCE_PCT,
  traderDockingCost: BG_TRADER_DOCKING_COST,
  foodStockpileMaxPerPop: 20.0,
  foodStockpileMinPerPop: 1.5,
  foodStressFactor: 1.0,
  combatDefenderAdvantage: 2.0,
  foodBasePrice: 6,
  combatFoodDamageMult: 1.0,
  traderLimitsAutomated: true,
};

export async function loadGameSettings(
  ctx: QueryCtx | MutationCtx,
  gameId: Id<"sim_games">,
): Promise<GameSettings> {
  const row = await ctx.db
    .query("sim_game_settings")
    .withIndex("by_gameId", (q) => q.eq("gameId", gameId))
    .unique();

  if (row === null) return { ...DEFAULT_GAME_SETTINGS };

  return {
    foodProdMult: row.foodProdMult,
    shipProdMult: row.shipProdMult,
    popGrowthMult: row.popGrowthMult,
    taxMult: row.taxMult,
    foodPriceElasticityMult: row.foodPriceElasticityMult,
    starvationMult: row.starvationMult,
    starvationFoodPriceCapMult:
      row.starvationFoodPriceCapMult ?? DEFAULT_GAME_SETTINGS.starvationFoodPriceCapMult,
    traderShipCostMult: row.traderShipCostMult,
    combatAttackMult: row.combatAttackMult,
    combatDefendMult: row.combatDefendMult,
    collateralDamageMult: row.collateralDamageMult,
    traderMinActive: row.traderMinActive ?? DEFAULT_GAME_SETTINGS.traderMinActive,
    traderMaxActive: row.traderMaxActive ?? DEFAULT_GAME_SETTINGS.traderMaxActive,
    traderShipHirePerTurn:
      row.traderShipHirePerTurn ?? DEFAULT_GAME_SETTINGS.traderShipHirePerTurn,
    traderHireChancePct:
      row.traderHireChancePct ?? DEFAULT_GAME_SETTINGS.traderHireChancePct,
    traderDockingCost: row.traderDockingCost ?? DEFAULT_GAME_SETTINGS.traderDockingCost,
    foodStockpileMaxPerPop:
      row.foodStockpileMaxPerPop ?? DEFAULT_GAME_SETTINGS.foodStockpileMaxPerPop,
    foodStockpileMinPerPop:
      row.foodStockpileMinPerPop ?? DEFAULT_GAME_SETTINGS.foodStockpileMinPerPop,
    foodStressFactor: row.foodStressFactor ?? DEFAULT_GAME_SETTINGS.foodStressFactor,
    combatDefenderAdvantage:
      row.combatDefenderAdvantage ?? DEFAULT_GAME_SETTINGS.combatDefenderAdvantage,
    foodBasePrice: row.foodBasePrice ?? DEFAULT_GAME_SETTINGS.foodBasePrice,
    combatFoodDamageMult:
      row.combatFoodDamageMult ?? DEFAULT_GAME_SETTINGS.combatFoodDamageMult,
    traderLimitsAutomated:
      row.traderLimitsAutomated ?? DEFAULT_GAME_SETTINGS.traderLimitsAutomated,
  };
}
