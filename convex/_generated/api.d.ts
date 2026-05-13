/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as admin_actions from "../admin/actions.js";
import type * as admin_internal from "../admin/internal.js";
import type * as admin_mutations from "../admin/mutations.js";
import type * as ai_internal from "../ai/internal.js";
import type * as auth from "../auth.js";
import type * as cmb_queries from "../cmb/queries.js";
import type * as col_colonyShipBuildCost from "../col/colonyShipBuildCost.js";
import type * as col_constants from "../col/constants.js";
import type * as col_mutations from "../col/mutations.js";
import type * as col_queries from "../col/queries.js";
import type * as col_routeValidation from "../col/routeValidation.js";
import type * as crons from "../crons.js";
import type * as eco_adminQueries from "../eco/adminQueries.js";
import type * as eco_internal from "../eco/internal.js";
import type * as eco_mutations from "../eco/mutations.js";
import type * as eco_queries from "../eco/queries.js";
import type * as eco_traderEconomics from "../eco/traderEconomics.js";
import type * as emp_internal from "../emp/internal.js";
import type * as emp_mutations from "../emp/mutations.js";
import type * as emp_queries from "../emp/queries.js";
import type * as flt_internal from "../flt/internal.js";
import type * as flt_mutations from "../flt/mutations.js";
import type * as flt_queries from "../flt/queries.js";
import type * as gal_hyperlaneGraph from "../gal/hyperlaneGraph.js";
import type * as gal_linkUtils from "../gal/linkUtils.js";
import type * as gal_mutations from "../gal/mutations.js";
import type * as gal_queries from "../gal/queries.js";
import type * as http from "../http.js";
import type * as migrations_backfillLegacyPopulation from "../migrations/backfillLegacyPopulation.js";
import type * as seed_empireColorPrefLookup from "../seed/empireColorPrefLookup.js";
import type * as seed_npcEmpirePlayers from "../seed/npcEmpirePlayers.js";
import type * as seed_npcEmpireSeed from "../seed/npcEmpireSeed.js";
import type * as seed_npcTraderCatalog from "../seed/npcTraderCatalog.js";
import type * as seed_npcTraderIdentitiesSeed from "../seed/npcTraderIdentitiesSeed.js";
import type * as seed_proximityLanes from "../seed/proximityLanes.js";
import type * as seed_v1CoreSeed from "../seed/v1CoreSeed.js";
import type * as seed_v1Medium from "../seed/v1Medium.js";
import type * as seed_v1MediumSeed from "../seed/v1MediumSeed.js";
import type * as seed_v1Twenty from "../seed/v1Twenty.js";
import type * as seed_v1TwentySeed from "../seed/v1TwentySeed.js";
import type * as sim_actions from "../sim/actions.js";
import type * as sim_combat from "../sim/combat.js";
import type * as sim_cron from "../sim/cron.js";
import type * as sim_economy_adjustAutomatedNpcTraderLimits from "../sim/economy/adjustAutomatedNpcTraderLimits.js";
import type * as sim_economy_applyBackgroundTrade from "../sim/economy/applyBackgroundTrade.js";
import type * as sim_economy_applyNpcStrategy from "../sim/economy/applyNpcStrategy.js";
import type * as sim_economy_applyTurnEconomy from "../sim/economy/applyTurnEconomy.js";
import type * as sim_economy_constants from "../sim/economy/constants.js";
import type * as sim_economy_foodPricing from "../sim/economy/foodPricing.js";
import type * as sim_economy_gameSettings from "../sim/economy/gameSettings.js";
import type * as sim_economy_garrison from "../sim/economy/garrison.js";
import type * as sim_economy_npcTraderRuntime from "../sim/economy/npcTraderRuntime.js";
import type * as sim_economy_population from "../sim/economy/population.js";
import type * as sim_eventLog from "../sim/eventLog.js";
import type * as sim_fleetDispatch from "../sim/fleetDispatch.js";
import type * as sim_fleetOrders from "../sim/fleetOrders.js";
import type * as sim_garrisonRoutes from "../sim/garrisonRoutes.js";
import type * as sim_helpers from "../sim/helpers.js";
import type * as sim_internal from "../sim/internal.js";
import type * as sim_mutations from "../sim/mutations.js";
import type * as sim_queries from "../sim/queries.js";
import type * as sim_systemHoldings from "../sim/systemHoldings.js";
import type * as sim_wipeGame from "../sim/wipeGame.js";
import type * as sim_wipeGamePhases from "../sim/wipeGamePhases.js";
import type * as trd_internal from "../trd/internal.js";
import type * as trd_mutations from "../trd/mutations.js";
import type * as trd_queries from "../trd/queries.js";
import type * as usr_mutations from "../usr/mutations.js";
import type * as usr_queries from "../usr/queries.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  "admin/actions": typeof admin_actions;
  "admin/internal": typeof admin_internal;
  "admin/mutations": typeof admin_mutations;
  "ai/internal": typeof ai_internal;
  auth: typeof auth;
  "cmb/queries": typeof cmb_queries;
  "col/colonyShipBuildCost": typeof col_colonyShipBuildCost;
  "col/constants": typeof col_constants;
  "col/mutations": typeof col_mutations;
  "col/queries": typeof col_queries;
  "col/routeValidation": typeof col_routeValidation;
  crons: typeof crons;
  "eco/adminQueries": typeof eco_adminQueries;
  "eco/internal": typeof eco_internal;
  "eco/mutations": typeof eco_mutations;
  "eco/queries": typeof eco_queries;
  "eco/traderEconomics": typeof eco_traderEconomics;
  "emp/internal": typeof emp_internal;
  "emp/mutations": typeof emp_mutations;
  "emp/queries": typeof emp_queries;
  "flt/internal": typeof flt_internal;
  "flt/mutations": typeof flt_mutations;
  "flt/queries": typeof flt_queries;
  "gal/hyperlaneGraph": typeof gal_hyperlaneGraph;
  "gal/linkUtils": typeof gal_linkUtils;
  "gal/mutations": typeof gal_mutations;
  "gal/queries": typeof gal_queries;
  http: typeof http;
  "migrations/backfillLegacyPopulation": typeof migrations_backfillLegacyPopulation;
  "seed/empireColorPrefLookup": typeof seed_empireColorPrefLookup;
  "seed/npcEmpirePlayers": typeof seed_npcEmpirePlayers;
  "seed/npcEmpireSeed": typeof seed_npcEmpireSeed;
  "seed/npcTraderCatalog": typeof seed_npcTraderCatalog;
  "seed/npcTraderIdentitiesSeed": typeof seed_npcTraderIdentitiesSeed;
  "seed/proximityLanes": typeof seed_proximityLanes;
  "seed/v1CoreSeed": typeof seed_v1CoreSeed;
  "seed/v1Medium": typeof seed_v1Medium;
  "seed/v1MediumSeed": typeof seed_v1MediumSeed;
  "seed/v1Twenty": typeof seed_v1Twenty;
  "seed/v1TwentySeed": typeof seed_v1TwentySeed;
  "sim/actions": typeof sim_actions;
  "sim/combat": typeof sim_combat;
  "sim/cron": typeof sim_cron;
  "sim/economy/adjustAutomatedNpcTraderLimits": typeof sim_economy_adjustAutomatedNpcTraderLimits;
  "sim/economy/applyBackgroundTrade": typeof sim_economy_applyBackgroundTrade;
  "sim/economy/applyNpcStrategy": typeof sim_economy_applyNpcStrategy;
  "sim/economy/applyTurnEconomy": typeof sim_economy_applyTurnEconomy;
  "sim/economy/constants": typeof sim_economy_constants;
  "sim/economy/foodPricing": typeof sim_economy_foodPricing;
  "sim/economy/gameSettings": typeof sim_economy_gameSettings;
  "sim/economy/garrison": typeof sim_economy_garrison;
  "sim/economy/npcTraderRuntime": typeof sim_economy_npcTraderRuntime;
  "sim/economy/population": typeof sim_economy_population;
  "sim/eventLog": typeof sim_eventLog;
  "sim/fleetDispatch": typeof sim_fleetDispatch;
  "sim/fleetOrders": typeof sim_fleetOrders;
  "sim/garrisonRoutes": typeof sim_garrisonRoutes;
  "sim/helpers": typeof sim_helpers;
  "sim/internal": typeof sim_internal;
  "sim/mutations": typeof sim_mutations;
  "sim/queries": typeof sim_queries;
  "sim/systemHoldings": typeof sim_systemHoldings;
  "sim/wipeGame": typeof sim_wipeGame;
  "sim/wipeGamePhases": typeof sim_wipeGamePhases;
  "trd/internal": typeof trd_internal;
  "trd/mutations": typeof trd_mutations;
  "trd/queries": typeof trd_queries;
  "usr/mutations": typeof usr_mutations;
  "usr/queries": typeof usr_queries;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
