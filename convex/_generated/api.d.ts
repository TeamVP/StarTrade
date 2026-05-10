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
import type * as eco_internal from "../eco/internal.js";
import type * as eco_queries from "../eco/queries.js";
import type * as emp_internal from "../emp/internal.js";
import type * as emp_mutations from "../emp/mutations.js";
import type * as emp_queries from "../emp/queries.js";
import type * as flt_internal from "../flt/internal.js";
import type * as flt_mutations from "../flt/mutations.js";
import type * as flt_queries from "../flt/queries.js";
import type * as gal_linkUtils from "../gal/linkUtils.js";
import type * as gal_queries from "../gal/queries.js";
import type * as http from "../http.js";
import type * as sim_helpers from "../sim/helpers.js";
import type * as sim_internal from "../sim/internal.js";
import type * as sim_mutations from "../sim/mutations.js";
import type * as sim_queries from "../sim/queries.js";
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
  "eco/internal": typeof eco_internal;
  "eco/queries": typeof eco_queries;
  "emp/internal": typeof emp_internal;
  "emp/mutations": typeof emp_mutations;
  "emp/queries": typeof emp_queries;
  "flt/internal": typeof flt_internal;
  "flt/mutations": typeof flt_mutations;
  "flt/queries": typeof flt_queries;
  "gal/linkUtils": typeof gal_linkUtils;
  "gal/queries": typeof gal_queries;
  http: typeof http;
  "sim/helpers": typeof sim_helpers;
  "sim/internal": typeof sim_internal;
  "sim/mutations": typeof sim_mutations;
  "sim/queries": typeof sim_queries;
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
