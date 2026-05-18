import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx } from "../../_generated/server";
import {
  COLLAPSE_INSOLVENCY_TURNS,
  COMMODITY_PRICE_DEFAULTS,
  DEFAULT_EMPIRE_TAX_RATE,
  EMPIRE_UPKEEP_PER_SIM_POP,
  FOOD_DEMAND_BUFFER,
  FOOD_EMPHASIS_REFERENCE_SHARE,
  FOOD_PER_POP,
  FOOD_PROD_MIN_FLOOR_FRACTION,
  FOOD_PROD_PER_POP,
  HOMEWORLD_PROD_MULT,
  HOMEWORLD_TAX_MULT,
  MAX_EMPIRE_TAX_RATE,
  MAX_WEAPONS_BONUS,
  POP_GROWTH_RATE,
  SHORTAGE_PROD_MULT,
  SHORTAGE_THRESHOLD_RATIO,
  STAR_SYSTEM_STARTING_TREASURY,
  STARVATION_FACTOR,
  TAX_PER_POP,
  WEAPONS_CONSUMPTION_RATE,
} from "./constants";
import { POPULATION_PEOPLE_PER_SIM_UNIT } from "./population";
import { addShipsToSystemGarrison } from "./garrison";
import {
  POPULATION_MIN_INHABITED_PEOPLE,
  clampPopulationPeople,
  populationToSimUnits,
} from "./population";
import { type GameSettings, loadGameSettings } from "./gameSettings";
import { computeSystemFoodPrice } from "./foodPricing";
import { insertSimEvent } from "../eventLog";
import { gameUsesTraderEconomy } from "../gameMode";
import { resolveGameActorIdForEmpire } from "../systemHoldings";

const STARVING_SHIP_EFFORT_CREDITS_PER_SHIP_POINT = 100;

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

function defaultBaseProductivity(resourceRichness: number): number {
  return clamp(Math.round(3 + resourceRichness * 7), 1, 10);
}

function normalizedEmphasis(system: Doc<"gal_systems">): {
  food: number;
  ships: number;
  research: number;
} {
  const f = system.emphasisFood ?? 34;
  const s = system.emphasisShips ?? 33;
  const r = system.emphasisResearch ?? 33;
  const sum = f + s + r;
  if (sum <= 0) return { food: 1 / 3, ships: 1 / 3, research: 1 / 3 };
  return { food: f / sum, ships: s / sum, research: r / sum };
}

function poweredShipEmphasis(shipShare: number, power: number): number {
  const referenceShare = 1 / 3;
  const safePower = clamp(power, 1, 3);
  if (shipShare <= 0) return 0;
  return Math.pow(shipShare, safePower) / Math.pow(referenceShare, safePower - 1);
}

function damagePenaltyMultiplier(
  populationPeople: number,
  recentDamagePopulationPeople: number,
): number {
  const denom = Math.max(1, populationPeople + recentDamagePopulationPeople);
  return 1 - Math.min(0.5, recentDamagePopulationPeople / denom);
}

async function abandonUnderpopulatedColony(
  ctx: MutationCtx,
  params: {
    gameId: Id<"sim_games">;
    turnNumber: number;
    system: Doc<"gal_systems">;
    empireId: Id<"emp_states">;
  },
): Promise<void> {
  const fleets = await ctx.db
    .query("flt_fleets")
    .withIndex("by_gameId_and_empireId_and_originSystemId_and_status", (q) =>
      q
        .eq("gameId", params.gameId)
        .eq("empireId", params.empireId)
        .eq("originSystemId", params.system._id)
        .eq("status", "idle"),
    )
    .take(32);
  for (const f of fleets) {
    await ctx.db.delete("flt_fleets", f._id);
  }

  const holding = await ctx.db
    .query("emp_system_holdings")
    .withIndex("by_gameId_and_systemId", (q) =>
      q.eq("gameId", params.gameId).eq("systemId", params.system._id),
    )
    .unique();
  if (holding !== null) {
    await ctx.db.delete("emp_system_holdings", holding._id);
  }

  await ctx.db.patch("gal_systems", params.system._id, {
    population: 0,
    ownerEmpireId: null,
    ownerGameActorId: undefined,
    underAttack: false,
    foodShortageTurns: 0,
    lastFoodShortageTurn: undefined,
    lastFoodShortageTurns: undefined,
    taxBlockedUntilTurn: undefined,
    lastContestedTurn: undefined,
  });

  await ctx.db.insert("sim_events", {
    gameId: params.gameId,
    turnNumber: params.turnNumber,
    eventType: "system_abandoned_underpopulation",
    actorType: "system",
    actorId: params.system._id,
    targetType: "empire",
    targetId: params.empireId,
    summary: `${params.system.name}: population fell below minimum — settlement abandoned`,
    payload: JSON.stringify({
      systemId: params.system._id,
      formerEmpireId: params.empireId,
    }),
  });
}

async function loadHoldingsBySystem(
  ctx: MutationCtx,
  gameId: Id<"sim_games">,
  empires: Doc<"emp_states">[],
): Promise<Map<Id<"gal_systems">, Doc<"emp_system_holdings">>> {
  const map = new Map<Id<"gal_systems">, Doc<"emp_system_holdings">>();
  for (const empire of empires) {
    const rows = await ctx.db
      .query("emp_system_holdings")
      .withIndex("by_gameId_and_empireId", (q) =>
        q.eq("gameId", gameId).eq("empireId", empire._id),
      )
      .take(256);
    for (const h of rows) {
      map.set(h.systemId, h);
    }
  }
  return map;
}

async function collapseEmpire(
  ctx: MutationCtx,
  params: {
    gameId: Id<"sim_games">;
    turnNumber: number;
    empireId: Id<"emp_states">;
  },
): Promise<void> {
  const empire = await ctx.db.get("emp_states", params.empireId);
  if (empire === null || empire.isCollapsed) return;

  const systems = await ctx.db
    .query("gal_systems")
    .withIndex("by_gameId", (q) => q.eq("gameId", params.gameId))
    .take(256);

  const home = empire.homeSystemId;
  for (const sys of systems) {
    if (sys.ownerEmpireId !== empire._id) continue;
    if (home !== null && sys._id === home) continue;

    await ctx.db.patch("gal_systems", sys._id, {
      ownerEmpireId: null,
      ownerGameActorId: undefined,
      localTreasury: STAR_SYSTEM_STARTING_TREASURY,
      underAttack: false,
      taxBlockedUntilTurn: undefined,
    });

    const holding = await ctx.db
      .query("emp_system_holdings")
      .withIndex("by_gameId_and_systemId", (q) =>
        q.eq("gameId", params.gameId).eq("systemId", sys._id),
      )
      .unique();
    if (holding !== null && holding.empireId === empire._id) {
      await ctx.db.delete("emp_system_holdings", holding._id);
    }
  }

  await ctx.db.patch("emp_states", empire._id, {
    isCollapsed: true,
    insolvencyTurns: 0,
    treasury: Math.max(0, empire.treasury),
  });

  const empireGameActorId = await resolveGameActorIdForEmpire(ctx, {
    gameId: params.gameId,
    empireId: empire._id,
  });

  await ctx.db.insert("sim_events", {
    gameId: params.gameId,
    turnNumber: params.turnNumber,
    eventType: "empire_collapse_started",
    actorType: empireGameActorId !== null ? "game_actor" : "empire",
    actorId: empireGameActorId ?? empire._id,
    targetType: null,
    targetId: null,
    summary: `${empire.name} collapsed — homeworld only retained`,
    payload: JSON.stringify({
      empireId: empire._id,
      ...(empireGameActorId !== null ? { gameActorId: empireGameActorId } : {}),
    }),
  });
}

function priceFromPressure(
  basePrice: number,
  elasticity: number,
  minMult: number,
  maxMult: number,
  pressure: number,
): number {
  const mult = clamp(1 + pressure * elasticity, minMult, maxMult);
  return basePrice * mult;
}

/**
 * Spec §7–13 economy: production, food/population, weapons, research, taxes,
 * market snapshots, empire aggregates, insolvency/collapse.
 */
export async function applyTurnEconomy(
  ctx: MutationCtx,
  params: {
    gameId: Id<"sim_games">;
    turnNumber: number;
    fleetIdsWithOrdersThisTurn: Set<string>;
    settings?: GameSettings;
  },
): Promise<void> {
  const settings = params.settings ?? (await loadGameSettings(ctx, params.gameId));
  const game = await ctx.db.get("sim_games", params.gameId);
  const persistEconomyHistory = game !== null && gameUsesTraderEconomy(game);

  const empires = await ctx.db
    .query("emp_states")
    .withIndex("by_gameId", (q) => q.eq("gameId", params.gameId))
    .take(64);

  const systems = await ctx.db
    .query("gal_systems")
    .withIndex("by_gameId", (q) => q.eq("gameId", params.gameId))
    .take(256);

  const holdingBySystem = await loadHoldingsBySystem(ctx, params.gameId, empires);
  const empireById = new Map(empires.map((e) => [e._id, e]));
  const actorIdByLegacyEmpireId = new Map<Id<"emp_states">, Id<"sim_game_actors">>();
  if ((game?.runtimeVersion ?? "v1_empire") === "v2_game_actor") {
    const actors = await ctx.db
      .query("sim_game_actors")
      .withIndex("by_gameId", (q) => q.eq("gameId", params.gameId))
      .collect();
    for (const actor of actors) {
      if (actor.legacyEmpireId !== null) {
        actorIdByLegacyEmpireId.set(actor.legacyEmpireId, actor._id);
      }
    }
  }

  const taxIncomeByEmpire = new Map<Id<"emp_states">, number>();
  const researchByEmpire = new Map<Id<"emp_states">, number>();
  const empireOwnedPop = new Map<Id<"emp_states">, number>();
  const empireOwnedFood = new Map<Id<"emp_states">, number>();

  for (const empire of empires) {
    taxIncomeByEmpire.set(empire._id, 0);
    researchByEmpire.set(empire._id, 0);
    empireOwnedPop.set(empire._id, 0);
    empireOwnedFood.set(empire._id, 0);
  }

  let aggFoodPressure = 0;
  let aggWeaponsPressure = 0;
  let aggHeavyPressure = 0;
  let nOwnedSystems = 0;

  for (const system of systems) {
    const ownerId = system.ownerEmpireId;
    if (ownerId === null) {
      // Unaligned worlds: maintain a small local treasury via a flat 5% “tax” baseline.
      // Uses the same tax base as empires (pop-based) but accrues to `localTreasury`.
      const populationPeople = clampPopulationPeople(system.population ?? 0);
      if (populationPeople < POPULATION_MIN_INHABITED_PEOPLE) continue;
      const taxOk =
        system.lastContestedTurn !== params.turnNumber &&
        (system.taxBlockedUntilTurn === undefined ||
          params.turnNumber > system.taxBlockedUntilTurn);
      if (!taxOk) continue;

      const simPop = populationToSimUnits(populationPeople);
      const taxBase = simPop * TAX_PER_POP;
      // Using DEFAULT_EMPIRE_TAX_RATE (5%) as the unowned-world baseline (so the ratio is 1.0).
      const income = taxBase * settings.taxMult;
      if (income > 0) {
        await ctx.db.patch("gal_systems", system._id, {
          localTreasury: Math.max(0, (system.localTreasury ?? 0) + income),
        });
      }
      continue;
    }

    const empire = empireById.get(ownerId);
    if (empire === undefined || empire.isCollapsed) continue;

    const r = clamp(
      empire.empireTaxRate ?? DEFAULT_EMPIRE_TAX_RATE,
      0,
      MAX_EMPIRE_TAX_RATE,
    );
    const prodAfterTax = 1 - r;

    const holding = holdingBySystem.get(system._id);
    const productionModifier = holding?.productionModifier ?? 1;
    const unrest = holding?.unrest ?? 0.05;

    const populationPeople = clampPopulationPeople(system.population ?? 0);
    const simPop = populationToSimUnits(populationPeople);
    const stockFood = Math.max(0, system.stockFood ?? 0);
    const stockWeapons = Math.max(0, system.stockWeapons ?? 0);
    const stockResearch = Math.max(0, system.stockResearch ?? 0);

    const baseProd =
      system.baseProductivity ?? defaultBaseProductivity(system.resourceRichness);
    const w = normalizedEmphasis(system);

    const isOwnedHomeworld =
      empire.homeSystemId !== null && system._id === empire.homeSystemId;
    const homeworldProdMult = isOwnedHomeworld ? HOMEWORLD_PROD_MULT : 1;

    const shortageMult =
      stockFood < simPop * FOOD_PER_POP * SHORTAGE_THRESHOLD_RATIO
        ? SHORTAGE_PROD_MULT
        : 1;

    const damageProdMult = damagePenaltyMultiplier(
      populationPeople,
      system.recentDamagePopulation ?? 0,
    );

    const weaponsNeed = Math.max(1, Math.floor(simPop * 0.1));
    const weaponsCoverage = Math.min(1, stockWeapons / weaponsNeed);
    const weaponsBonusMult =
      1 + MAX_WEAPONS_BONUS * weaponsCoverage * w.ships;

    const effectiveProductivity = Math.max(
      0,
      baseProd *
        homeworldProdMult *
        productionModifier *
        shortageMult *
        damageProdMult *
        prodAfterTax,
    );

    // Food production scales with population: more people → more farmers.
    // Equilibrium: simPop × baseProd × FOOD_PROD_PER_POP × w.food = simPop × FOOD_PER_POP
    //   → w_eq = FOOD_PER_POP / (baseProd × FOOD_PROD_PER_POP × productionModifier)
    //
    // NOTE: shortageMult is intentionally NOT applied here. Applying a shortage
    // penalty to food production creates a self-perpetuating death spiral: low stock →
    // lower production → stock stays at zero → shortage persists. People farm harder
    // when hungry, not less. Ships/research (effectiveProductivity) still carry the penalty.
    //
    // Subsistence floor scales with food emphasis: at ~default food share you keep at least
    // FOOD_PROD_MIN_FLOOR_FRACTION of demand; at near-zero food weight the floor drops so local
    // output follows the slider (imports / stock carry the colony).
    const foodDemand = simPop * FOOD_PER_POP;
    const rawFoodProduced = Math.floor(
      simPop *
        baseProd *
        FOOD_PROD_PER_POP *
        w.food *
        homeworldProdMult *
        productionModifier *
        damageProdMult *
        prodAfterTax *
        settings.foodProdMult,
    );
    const subsistenceShare = Math.min(1, w.food / FOOD_EMPHASIS_REFERENCE_SHARE);
    const foodProdFloor = Math.ceil(
      foodDemand * FOOD_PROD_MIN_FLOOR_FRACTION * subsistenceShare,
    );
    const foodProduced = Math.max(rawFoodProduced, foodProdFloor);
    const colonyFoodBonus = system.colonyFoodBonusPerTurn ?? 0;
    const foodProducedTotal = foodProduced + colonyFoodBonus;
    // Ships/research are capital-intensive (infrastructure-limited, not headcount-limited).
    const shipProductionWeight = poweredShipEmphasis(
      w.ships,
      settings.shipProdEmphasisPower,
    );
    const potentialShipsProduced = Math.max(
      0,
      Math.floor(
        effectiveProductivity *
          shipProductionWeight *
          weaponsBonusMult *
          settings.shipProdMult,
      ),
    );
    const researchProduced = Math.floor(effectiveProductivity * w.research);

    const foodAvailable = stockFood + foodProducedTotal;
    const foodNet = foodAvailable - foodDemand;
    const foodShortage = foodNet < 0;
    const foodShortageTurns = foodShortage ? (system.foodShortageTurns ?? 0) + 1 : 0;
    const lastFoodShortageTurn = foodShortage
      ? params.turnNumber
      : system.lastFoodShortageTurn;
    const lastFoodShortageTurns = foodShortage
      ? foodShortageTurns
      : system.lastFoodShortageTurns;
    const shipEffortTreasuryIncome = foodShortage
      ? potentialShipsProduced * STARVING_SHIP_EFFORT_CREDITS_PER_SHIP_POINT
      : 0;
    const shipsProduced = foodShortage ? 0 : potentialShipsProduced;

    let newPop = populationPeople;
    let newFoodStock = 0;
    if (foodNet >= 0) {
      newFoodStock = foodNet;
      const comfortExcess = foodNet > foodDemand * 0.1;
      const lowDamage =
        (system.recentDamagePopulation ?? 0) < populationPeople * 0.05;
      if (comfortExcess && lowDamage && populationPeople > 0) {
        const growth = Math.floor(populationPeople * POP_GROWTH_RATE * settings.popGrowthMult);
        newPop = clampPopulationPeople(populationPeople + growth);
      }
    } else {
      const shortfall = Math.abs(foodNet); // in sim-pop food units
      // Convert to absolute people: each sim-unit of shortfall kills STARVATION_FACTOR sim-units of pop.
      const popLossPeople = Math.ceil(
        shortfall * STARVATION_FACTOR * settings.starvationMult * POPULATION_PEOPLE_PER_SIM_UNIT,
      );
      newPop = Math.max(0, populationPeople - popLossPeople);
      newFoodStock = 0;
      newPop = clampPopulationPeople(newPop);
      if (newPop < populationPeople) {
        await ctx.db.insert("sim_events", {
          gameId: params.gameId,
          turnNumber: params.turnNumber,
          eventType: "food_crisis_started",
          actorType: "system",
          actorId: system._id,
          targetType: "system",
          targetId: system._id,
          summary: `${system.name}: starvation after food shortage`,
          payload: JSON.stringify({ systemId: system._id, shortfall }),
        });
      }
    }

    newPop = clampPopulationPeople(newPop);

    if (newPop < POPULATION_MIN_INHABITED_PEOPLE) {
      await abandonUnderpopulatedColony(ctx, {
        gameId: params.gameId,
        turnNumber: params.turnNumber,
        system,
        empireId: ownerId,
      });
      continue;
    }

    let garrisonShips = shipsProduced;
    const colonyBuildPatch: Partial<Doc<"gal_systems">> = {};
    if (
      isOwnedHomeworld &&
      system.colonyShipBuildEnabled === true &&
      (system.colonyShipBuildCost ?? 0) > 0
    ) {
      const cost = system.colonyShipBuildCost as number;
      const progress0 = system.colonyShipBuildProgress ?? 0;
      if (progress0 < cost) {
        const divert = Math.min(shipsProduced, cost - progress0);
        const newProgress = progress0 + divert;
        garrisonShips = shipsProduced - divert;
        if (newProgress >= cost) {
          const ownerGameActorId = actorIdByLegacyEmpireId.get(ownerId) ?? null;
          await ctx.db.insert("col_colony_ships", {
            gameId: params.gameId,
            empireId: ownerId,
            ...(ownerGameActorId !== null ? { gameActorId: ownerGameActorId } : {}),
            name: `${system.name} colony ship`,
            originSystemId: system._id,
            destinationSystemId: null,
            etaTurn: null,
            status: "idle",
          });
          colonyBuildPatch.colonyShipBuildEnabled = false;
          colonyBuildPatch.colonyShipBuildProgress = 0;
          colonyBuildPatch.colonyShipBuildCost = 0;
          await insertSimEvent(ctx, {
            gameId: params.gameId,
            turnNumber: params.turnNumber,
            eventType: "colony_ship_completed",
            actorType: "system",
            actorId: system._id,
            targetType: ownerGameActorId !== null ? "game_actor" : "empire",
            targetId: ownerGameActorId ?? ownerId,
            summary: `${system.name}: colony ship ready for launch`,
            payload: { systemId: system._id, empireId: ownerId },
          });
        } else {
          colonyBuildPatch.colonyShipBuildProgress = newProgress;
        }
      }
    }

    let newWeapons = stockWeapons;
    if (garrisonShips > 0) {
      const consumed = Math.ceil(garrisonShips * WEAPONS_CONSUMPTION_RATE);
      newWeapons = Math.max(0, stockWeapons - consumed);
      await addShipsToSystemGarrison(ctx, {
        gameId: params.gameId,
        system,
        empire,
        shipsToAdd: garrisonShips,
        fleetIdsWithOrdersThisTurn: params.fleetIdsWithOrdersThisTurn,
      });
    }

    const newResearchStock = stockResearch + researchProduced;
    researchByEmpire.set(
      ownerId,
      (researchByEmpire.get(ownerId) ?? 0) + researchProduced,
    );

    const stockpileDemand = Math.max(1, populationToSimUnits(newPop) * FOOD_PER_POP);
    const foodPrice = computeSystemFoodPrice({
      stockFood: newFoodStock,
      foodDemand: stockpileDemand,
      foodNet,
      settings,
    });

    const taxOk =
      system.lastContestedTurn !== params.turnNumber &&
      newPop >= POPULATION_MIN_INHABITED_PEOPLE &&
      (system.taxBlockedUntilTurn === undefined ||
        params.turnNumber > system.taxBlockedUntilTurn);

    let localTaxIncome = 0;
    if (taxOk) {
      const taxBase = populationToSimUnits(newPop) * TAX_PER_POP;
      const hwTax = isOwnedHomeworld ? HOMEWORLD_TAX_MULT : 1;
      const stabMult = clamp(1 - unrest * 0.35, 0.5, 1.25);
      const damageTax = damagePenaltyMultiplier(
        newPop,
        system.recentDamagePopulation ?? 0,
      );
      const income =
        taxBase *
        hwTax *
        stabMult *
        damageTax *
        settings.taxMult *
        (r / DEFAULT_EMPIRE_TAX_RATE);
      // Half of collected tax stays in the local system treasury; the rest goes imperial.
      localTaxIncome = income * 0.5;
      taxIncomeByEmpire.set(
        ownerId,
        (taxIncomeByEmpire.get(ownerId) ?? 0) + income - localTaxIncome,
      );
    }

    const localTreasuryIncome = shipEffortTreasuryIncome + localTaxIncome;

    await ctx.db.patch("gal_systems", system._id, {
      stockFood: newFoodStock,
      stockWeapons: newWeapons,
      stockResearch: newResearchStock,
      population: newPop,
      foodPrice,
      foodShortageTurns,
      lastFoodShortageTurn,
      lastFoodShortageTurns,
      ...(localTreasuryIncome > 0
        ? {
            localTreasury: Math.max(
              0,
              (system.localTreasury ?? 0) + localTreasuryIncome,
            ),
          }
        : {}),
      ...colonyBuildPatch,
    });

    empireOwnedPop.set(ownerId, (empireOwnedPop.get(ownerId) ?? 0) + newPop);
    empireOwnedFood.set(ownerId, (empireOwnedFood.get(ownerId) ?? 0) + newFoodStock);

    nOwnedSystems += 1;
    aggFoodPressure +=
      (stockpileDemand + FOOD_DEMAND_BUFFER - newFoodStock) / stockpileDemand;
    aggWeaponsPressure +=
      (weaponsNeed * 2 - newWeapons) / Math.max(1, weaponsNeed);
    aggHeavyPressure += 1 - clamp(system.resourceRichness, 0, 1);
  }

  for (const empire of empires) {
    if (empire.isCollapsed) continue;

    const tax = taxIncomeByEmpire.get(empire._id) ?? 0;
    const researchAdded = researchByEmpire.get(empire._id) ?? 0;
    const ownedPop = empireOwnedPop.get(empire._id) ?? 0;
    const upkeep = populationToSimUnits(ownedPop) * EMPIRE_UPKEEP_PER_SIM_POP;
    let treasury = empire.treasury + tax - upkeep;

    await ctx.db.patch("emp_states", empire._id, {
      treasury,
      researchPool: (empire.researchPool ?? 0) + researchAdded,
      population: ownedPop,
      foodStockpile: empireOwnedFood.get(empire._id) ?? 0,
    });

    const updated = await ctx.db.get("emp_states", empire._id);
    if (updated === null) continue;
    treasury = updated.treasury;

    let insolvency = updated.insolvencyTurns ?? 0;
    if (treasury <= 0) {
      insolvency += 1;
    } else {
      insolvency = 0;
    }

    await ctx.db.patch("emp_states", empire._id, { insolvencyTurns: insolvency });

    if (insolvency >= COLLAPSE_INSOLVENCY_TURNS && !updated.isCollapsed) {
      await collapseEmpire(ctx, {
        gameId: params.gameId,
        turnNumber: params.turnNumber,
        empireId: updated._id,
      });
    }
  }

  if (persistEconomyHistory && nOwnedSystems > 0) {
    const fMean = aggFoodPressure / nOwnedSystems;
    const wMean = aggWeaponsPressure / nOwnedSystems;
    const hMean = aggHeavyPressure / nOwnedSystems;

    const fd = COMMODITY_PRICE_DEFAULTS.food;
    const wd = COMMODITY_PRICE_DEFAULTS.weapons;
    const hd = COMMODITY_PRICE_DEFAULTS.heavy_metals;

    await ctx.db.insert("eco_market_snapshots", {
      gameId: params.gameId,
      turnNumber: params.turnNumber,
      commodity: "food",
      unitPrice: priceFromPressure(
        fd.basePrice,
        fd.elasticity,
        fd.minMult,
        fd.maxMult,
        fMean,
      ),
      volume: Math.round(fMean * 100),
    });
    await ctx.db.insert("eco_market_snapshots", {
      gameId: params.gameId,
      turnNumber: params.turnNumber,
      commodity: "weapons",
      unitPrice: priceFromPressure(
        wd.basePrice,
        wd.elasticity,
        wd.minMult,
        wd.maxMult,
        wMean,
      ),
      volume: Math.round(wMean * 100),
    });
    await ctx.db.insert("eco_market_snapshots", {
      gameId: params.gameId,
      turnNumber: params.turnNumber,
      commodity: "heavy_metals",
      unitPrice: priceFromPressure(
        hd.basePrice,
        hd.elasticity,
        hd.minMult,
        hd.maxMult,
        hMean,
      ),
      volume: Math.round(hMean * 100),
    });
  }
}
