/**
 * Canonical default god-mode/balance settings and the loader that reads per-game overrides.
 * Core settings now live in `sim_game_settings`; trader-only settings live in
 * `sim_game_trader_settings`. Missing rows fall back to current defaults.
 */

import type { Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import { gameUsesTraderEconomy } from "../gameMode";
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
  starvationFoodPriceCapMult: number;
  traderShipCostMult: number;
  combatAttackMult: number;
  combatDefendMult: number;
  collateralDamageMult: number;
  shipProdEmphasisPower: number;
  traderMinActive: number;
  traderMaxActive: number;
  traderShipHirePerTurn: number;
  traderHireChancePct: number;
  traderDockingCost: number;
  localTreasuryAddsPer100Cr: number;
  foodStockpileMaxPerPop: number;
  foodStockpileMinPerPop: number;
  foodStressFactor: number;
  combatDefenderAdvantage: number;
  foodBasePrice: number;
  combatFoodDamageMult: number;
  traderLimitsAutomated: boolean;
};

type SharedGameSettings = Pick<
  GameSettings,
  | "foodProdMult"
  | "shipProdMult"
  | "popGrowthMult"
  | "taxMult"
  | "foodPriceElasticityMult"
  | "starvationMult"
  | "starvationFoodPriceCapMult"
  | "combatAttackMult"
  | "combatDefendMult"
  | "collateralDamageMult"
  | "shipProdEmphasisPower"
  | "foodStockpileMaxPerPop"
  | "foodStockpileMinPerPop"
  | "foodStressFactor"
  | "combatDefenderAdvantage"
  | "foodBasePrice"
  | "combatFoodDamageMult"
>;

type TraderGameSettings = Pick<
  GameSettings,
  | "traderShipCostMult"
  | "traderMinActive"
  | "traderMaxActive"
  | "traderShipHirePerTurn"
  | "traderHireChancePct"
  | "traderDockingCost"
  | "localTreasuryAddsPer100Cr"
  | "traderLimitsAutomated"
>;

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
  shipProdEmphasisPower: 1.8,
  traderMinActive: 0,
  traderMaxActive: BG_TRADER_AUTOMATED_INITIAL_MAX_ACTIVE,
  traderShipHirePerTurn: BG_TRADER_SHIP_HIRE_PER_TURN,
  traderHireChancePct: BG_TRADER_HIRE_CHANCE_PCT,
  traderDockingCost: BG_TRADER_DOCKING_COST,
  localTreasuryAddsPer100Cr: 50,
  foodStockpileMaxPerPop: 20.0,
  foodStockpileMinPerPop: 2.0,
  foodStressFactor: 1.0,
  combatDefenderAdvantage: 3.0,
  foodBasePrice: 6,
  combatFoodDamageMult: 4.0,
  traderLimitsAutomated: true,
};

const SHARED_GAME_SETTINGS_KEYS = [
  "foodProdMult",
  "shipProdMult",
  "popGrowthMult",
  "taxMult",
  "foodPriceElasticityMult",
  "starvationMult",
  "starvationFoodPriceCapMult",
  "combatAttackMult",
  "combatDefendMult",
  "collateralDamageMult",
  "shipProdEmphasisPower",
  "foodStockpileMaxPerPop",
  "foodStockpileMinPerPop",
  "foodStressFactor",
  "combatDefenderAdvantage",
  "foodBasePrice",
  "combatFoodDamageMult",
] as const satisfies ReadonlyArray<keyof SharedGameSettings>;

const TRADER_GAME_SETTINGS_KEYS = [
  "traderShipCostMult",
  "traderMinActive",
  "traderMaxActive",
  "traderShipHirePerTurn",
  "traderHireChancePct",
  "traderDockingCost",
  "localTreasuryAddsPer100Cr",
  "traderLimitsAutomated",
] as const satisfies ReadonlyArray<keyof TraderGameSettings>;

const GAME_SETTINGS_DEFAULT_KEYS = [
  ...SHARED_GAME_SETTINGS_KEYS,
  ...TRADER_GAME_SETTINGS_KEYS,
] as const satisfies ReadonlyArray<keyof GameSettings>;

type TraderResettableSettings = TraderGameSettings;

export function withTraderSettingsReset<T extends TraderResettableSettings>(settings: T): T {
  return {
    ...settings,
    traderShipCostMult: DEFAULT_GAME_SETTINGS.traderShipCostMult,
    traderMinActive: DEFAULT_GAME_SETTINGS.traderMinActive,
    traderMaxActive: DEFAULT_GAME_SETTINGS.traderMaxActive,
    traderShipHirePerTurn: DEFAULT_GAME_SETTINGS.traderShipHirePerTurn,
    traderHireChancePct: DEFAULT_GAME_SETTINGS.traderHireChancePct,
    traderDockingCost: DEFAULT_GAME_SETTINGS.traderDockingCost,
    localTreasuryAddsPer100Cr: DEFAULT_GAME_SETTINGS.localTreasuryAddsPer100Cr,
    traderLimitsAutomated: DEFAULT_GAME_SETTINGS.traderLimitsAutomated,
  };
}

function pickSharedGameSettings(settings: GameSettings): SharedGameSettings {
  return Object.fromEntries(
    SHARED_GAME_SETTINGS_KEYS.map((key) => [key, settings[key]]),
  ) as SharedGameSettings;
}

function pickTraderGameSettings(settings: GameSettings): TraderGameSettings {
  return Object.fromEntries(
    TRADER_GAME_SETTINGS_KEYS.map((key) => [key, settings[key]]),
  ) as TraderGameSettings;
}

function settingsSubsetMatchesDefaults<
  TSettings extends Record<string, number | boolean>,
  TKey extends keyof TSettings,
>(
  settings: TSettings,
  keys: readonly TKey[],
): boolean {
  return keys.every(
    (key) => settings[key] === DEFAULT_GAME_SETTINGS[key as keyof GameSettings],
  );
}

export function normalizeGameSettingsForMode(
  game: Pick<
    { mode?: "conquest_core" | "conquest_plus" | "trader_economy" | null | undefined },
    "mode"
  >,
  settings: GameSettings,
): GameSettings {
  return gameUsesTraderEconomy(game)
    ? settings
    : {
        ...settings,
        ...withTraderSettingsReset(pickTraderGameSettings(settings)),
      };
}

export function gameSettingsMatchDefaults(settings: GameSettings): boolean {
  return GAME_SETTINGS_DEFAULT_KEYS.every((key) => settings[key] === DEFAULT_GAME_SETTINGS[key]);
}

export async function persistGameSettings(
  ctx: MutationCtx,
  game: {
    _id: Id<"sim_games">;
    mode?: "conquest_core" | "conquest_plus" | "trader_economy" | null | undefined;
  },
  settings: GameSettings,
): Promise<void> {
  const nextSettings = normalizeGameSettingsForMode(game, settings);
  const [existingShared, existingTrader] = await Promise.all([
    ctx.db
      .query("sim_game_settings")
      .withIndex("by_gameId", (q) => q.eq("gameId", game._id))
      .unique(),
    ctx.db
      .query("sim_game_trader_settings")
      .withIndex("by_gameId", (q) => q.eq("gameId", game._id))
      .unique(),
  ]);

  const sharedSettings = pickSharedGameSettings(nextSettings);
  const traderSettings = pickTraderGameSettings(nextSettings);

  if (settingsSubsetMatchesDefaults(sharedSettings, SHARED_GAME_SETTINGS_KEYS)) {
    if (existingShared !== null) {
      await ctx.db.delete("sim_game_settings", existingShared._id);
    }
  } else {
    const sharedRow = {
      gameId: game._id,
      ...sharedSettings,
    };
    if (existingShared === null) {
      await ctx.db.insert("sim_game_settings", sharedRow);
    } else {
      await ctx.db.replace("sim_game_settings", existingShared._id, sharedRow);
    }
  }

  if (
    !gameUsesTraderEconomy(game) ||
    settingsSubsetMatchesDefaults(traderSettings, TRADER_GAME_SETTINGS_KEYS)
  ) {
    if (existingTrader !== null) {
      await ctx.db.delete("sim_game_trader_settings", existingTrader._id);
    }
    return;
  }

  const traderRow = {
    gameId: game._id,
    ...traderSettings,
  };
  if (existingTrader === null) {
    await ctx.db.insert("sim_game_trader_settings", traderRow);
  } else {
    await ctx.db.replace("sim_game_trader_settings", existingTrader._id, traderRow);
  }
}

export async function loadGameSettings(
  ctx: QueryCtx | MutationCtx,
  gameId: Id<"sim_games">,
): Promise<GameSettings> {
  const [row, traderRow] = await Promise.all([
    ctx.db
      .query("sim_game_settings")
      .withIndex("by_gameId", (q) => q.eq("gameId", gameId))
      .unique(),
    ctx.db
      .query("sim_game_trader_settings")
      .withIndex("by_gameId", (q) => q.eq("gameId", gameId))
      .unique(),
  ]);

  if (row === null && traderRow === null) {
    return { ...DEFAULT_GAME_SETTINGS };
  }

  return {
    foodProdMult: row?.foodProdMult ?? DEFAULT_GAME_SETTINGS.foodProdMult,
    shipProdMult: row?.shipProdMult ?? DEFAULT_GAME_SETTINGS.shipProdMult,
    popGrowthMult: row?.popGrowthMult ?? DEFAULT_GAME_SETTINGS.popGrowthMult,
    taxMult: row?.taxMult ?? DEFAULT_GAME_SETTINGS.taxMult,
    foodPriceElasticityMult:
      row?.foodPriceElasticityMult ?? DEFAULT_GAME_SETTINGS.foodPriceElasticityMult,
    starvationMult: row?.starvationMult ?? DEFAULT_GAME_SETTINGS.starvationMult,
    starvationFoodPriceCapMult:
      row?.starvationFoodPriceCapMult ?? DEFAULT_GAME_SETTINGS.starvationFoodPriceCapMult,
    traderShipCostMult:
      traderRow?.traderShipCostMult ??
      row?.traderShipCostMult ??
      DEFAULT_GAME_SETTINGS.traderShipCostMult,
    combatAttackMult: row?.combatAttackMult ?? DEFAULT_GAME_SETTINGS.combatAttackMult,
    combatDefendMult: row?.combatDefendMult ?? DEFAULT_GAME_SETTINGS.combatDefendMult,
    collateralDamageMult:
      row?.collateralDamageMult ?? DEFAULT_GAME_SETTINGS.collateralDamageMult,
    shipProdEmphasisPower:
      row?.shipProdEmphasisPower ?? DEFAULT_GAME_SETTINGS.shipProdEmphasisPower,
    traderMinActive:
      traderRow?.traderMinActive ??
      row?.traderMinActive ??
      DEFAULT_GAME_SETTINGS.traderMinActive,
    traderMaxActive:
      traderRow?.traderMaxActive ??
      row?.traderMaxActive ??
      DEFAULT_GAME_SETTINGS.traderMaxActive,
    traderShipHirePerTurn:
      traderRow?.traderShipHirePerTurn ??
      row?.traderShipHirePerTurn ??
      DEFAULT_GAME_SETTINGS.traderShipHirePerTurn,
    traderHireChancePct:
      traderRow?.traderHireChancePct ??
      row?.traderHireChancePct ??
      DEFAULT_GAME_SETTINGS.traderHireChancePct,
    traderDockingCost:
      traderRow?.traderDockingCost ??
      row?.traderDockingCost ??
      DEFAULT_GAME_SETTINGS.traderDockingCost,
    localTreasuryAddsPer100Cr:
      traderRow?.localTreasuryAddsPer100Cr ??
      row?.localTreasuryAddsPer100Cr ??
      DEFAULT_GAME_SETTINGS.localTreasuryAddsPer100Cr,
    foodStockpileMaxPerPop:
      row?.foodStockpileMaxPerPop ?? DEFAULT_GAME_SETTINGS.foodStockpileMaxPerPop,
    foodStockpileMinPerPop:
      row?.foodStockpileMinPerPop ?? DEFAULT_GAME_SETTINGS.foodStockpileMinPerPop,
    foodStressFactor: row?.foodStressFactor ?? DEFAULT_GAME_SETTINGS.foodStressFactor,
    combatDefenderAdvantage:
      row?.combatDefenderAdvantage ?? DEFAULT_GAME_SETTINGS.combatDefenderAdvantage,
    foodBasePrice: row?.foodBasePrice ?? DEFAULT_GAME_SETTINGS.foodBasePrice,
    combatFoodDamageMult:
      row?.combatFoodDamageMult ?? DEFAULT_GAME_SETTINGS.combatFoodDamageMult,
    traderLimitsAutomated:
      traderRow?.traderLimitsAutomated ??
      row?.traderLimitsAutomated ??
      DEFAULT_GAME_SETTINGS.traderLimitsAutomated,
  };
}
