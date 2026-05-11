/**
 * Canonical pool of 32 named NPC merchant identities (captains / companies / classics).
 * Each game gets one `sim_trader_identities` row per catalog entry (see npcTraderIdentitiesSeed).
 */
export type NpcTraderCatalogEntry = {
  catalogKey: string;
  displayName: string;
  /** House line, company, or style — shown in UI as secondary line. */
  affiliation: string;
};

export const NPC_TRADER_CATALOG: readonly NpcTraderCatalogEntry[] = [
  { catalogKey: "horn_line", displayName: "Horatio Hornblower", affiliation: "His Majesty's Contract Freight" },
  { catalogKey: "aubrey_line", displayName: "Jack Aubrey", affiliation: "Surprise Mercantile Charter" },
  { catalogKey: "solo_express", displayName: "Han Solo", affiliation: "Corellian Run Express" },
  { catalogKey: "reynolds_free", displayName: "Malcolm Reynolds", affiliation: "Browncoat Independent Haulage" },
  { catalogKey: "picard_vintage", displayName: "Jean-Luc Picard", affiliation: "Château Picard Orbital Cellars" },
  { catalogKey: "kirk_prise", displayName: "James T. Kirk", affiliation: "Enterprise Prize Cargo Ltd." },
  { catalogKey: "janeway_delta", displayName: "Kathryn Janeway", affiliation: "Delta Quadrant Coffee & Spice" },
  { catalogKey: "weyland_bulk", displayName: "Ellen Ripley", affiliation: "Weyland-Yutani Bulk Disposal" },
  { catalogKey: "tyrell_greens", displayName: "Roy Batty", affiliation: "Tyrell Offworld Organics" },
  { catalogKey: "morrow_lines", displayName: "Case", affiliation: "Morrow Star Lines" },
  { catalogKey: "spice_must", displayName: "Duncan Idaho", affiliation: "Spacing Guild Auxiliary" },
  { catalogKey: "atreides_convoy", displayName: "Gurney Halleck", affiliation: "Atreides War-Bard Logistics" },
  { catalogKey: "harkonnen_heavy", displayName: "Beast Rabban", affiliation: "Harkonnen Heavy Lift (uninsured)" },
  { catalogKey: "fremen_silica", displayName: "Stilgar", affiliation: "Sietch Tabr Caravan" },
  { catalogKey: "vogon_paper", displayName: "Prostetnic Vogon Jeltz", affiliation: "Vogon Constructor Fleet — Forms Dept." },
  { catalogKey: "zaphod_cargo", displayName: "Zaphod Beeblebrox", affiliation: "Heart of Gold Odd Lots" },
  { catalogKey: "ford_prefect", displayName: "Ford Prefect", affiliation: "Hitchhiker's Towel & Rations" },
  { catalogKey: "silver_spanish", displayName: "Long John Silver", affiliation: "Spanish Main Salvage Co." },
  { catalogKey: "blackbeard_raid", displayName: "Edward Teach", affiliation: "Queen Anne's Revenge Trading" },
  { catalogKey: "morgan_buccaneer", displayName: "Henry Morgan", affiliation: "Buccaneer Consolidated Freight" },
  { catalogKey: "drake_circum", displayName: "Francis Drake", affiliation: "Golden Hind Circumnavigation Lines" },
  { catalogKey: "cook_pacific", displayName: "James Cook", affiliation: "Pacific Survey & Supply" },
  { catalogKey: "brunel_iron", displayName: "Isambard Kingdom Brunel", affiliation: "Great Eastern Steamship Co." },
  { catalogKey: "east_india", displayName: "Robert Clive", affiliation: "Honourable Stellar India Company" },
  { catalogKey: "cutler_beckett", displayName: "Cutler Beckett", affiliation: "East India Trading — Assets & Acquisitions" },
  { catalogKey: "niska_sky", displayName: "Adelai Niska", affiliation: "Skyplex Bonded Freight" },
  { catalogKey: "firefly_os", displayName: "Hoban Washburne", affiliation: "Leaf on the Wind Courier" },
  { catalogKey: "belter_union", displayName: "Camina Drummer", affiliation: "Outer Planets Alliance Freight" },
  { catalogKey: "rocinante", displayName: "James Holden", affiliation: "Rocinante Cooperative Haulage" },
  { catalogKey: "millenium_bulk", displayName: "Lando Calrissian", affiliation: "Cloud City Bulk & Gaming" },
  { catalogKey: "quark_bar", displayName: "Quark", affiliation: "Quark's Bar, Grill, Games & Freight" },
  { catalogKey: "odo_watch", displayName: "Odo", affiliation: "Bajoran Constabulary Bonded Carriers" },
] as const;

export const NPC_TRADER_CATALOG_SIZE = NPC_TRADER_CATALOG.length;
