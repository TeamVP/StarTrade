/** Ordered phases for deleting all documents scoped to a game (dependency-safe). */
export const WIPE_GAME_PHASES = [
  "sim_events",
  "sim_turn_preparation_ops",
  "sim_turn_preparations",
  "sim_turns",
  "flt_orders",
  "flt_garrison_routes",
  "trd_runs",
  "trd_charters",
  "eco_market_snapshots",
  "eco_system_outputs",
  "eco_bg_traders",
  "sim_trader_identities",
  "sim_game_settings",
  "sim_game_trader_settings",
  "sim_game_actors",
  "cmb_battles",
  "col_colony_ships",
  "emp_priority_stars",
  "flt_fleets",
  "emp_system_holdings",
  "gal_links",
  "gal_systems",
  "emp_states",
  "usr_game_roles",
] as const;

export type WipeGamePhase = (typeof WIPE_GAME_PHASES)[number];
