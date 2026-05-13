import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { authTables } from "@convex-dev/auth/server";

export default defineSchema({
  ...authTables,
  sim_games: defineTable({
    name: v.string(),
    status: v.union(
      v.literal("lobby"),
      v.literal("running"),
      v.literal("paused"),
      v.literal("finished"),
    ),
    mapKey: v.string(),
    turnDurationMs: v.number(),
    currentTurn: v.number(),
    seed: v.string(),
    startedAt: v.union(v.number(), v.null()),
    endedAt: v.union(v.number(), v.null()),
    /** Global turn timer pause (real-time ms); cron skips resolve while Date.now() < this. */
    turnPausedUntilMs: v.optional(v.number()),
    /**
     * When true, the StarTrade cron does not auto-start turn resolution for this game.
     * Status stays `running`; manual “Step turn” still works. Use to isolate a broken sim.
     */
    simCronTurnsDisabled: v.optional(v.boolean()),
    /** Selected NPC empire roster keys to seed when the map is created. */
    npcEmpireKeys: v.optional(v.array(v.string())),
  }).index("by_status", ["status"]),

  sim_turns: defineTable({
    gameId: v.id("sim_games"),
    turnNumber: v.number(),
    startedAt: v.number(),
    resolvedAt: v.union(v.number(), v.null()),
    resolvingStartedAt: v.optional(v.number()),
    resolutionPhase: v.optional(
      v.union(
        v.literal("movement"),
        v.literal("economy"),
        v.literal("npc"),
        v.literal("trade"),
        v.literal("traderSetup"),
        v.literal("tradeSpawn"),
        v.literal("garrisons"),
        v.literal("finalize"),
      ),
    ),
    state: v.union(
      v.literal("open"),
      v.literal("resolving"),
      v.literal("resolved"),
    ),
  })
    .index("by_gameId", ["gameId"])
    .index("by_gameId_and_turnNumber", ["gameId", "turnNumber"]),

  sim_events: defineTable({
    gameId: v.id("sim_games"),
    turnNumber: v.number(),
    eventType: v.string(),
    actorType: v.string(),
    actorId: v.string(),
    targetType: v.union(v.string(), v.null()),
    targetId: v.union(v.string(), v.null()),
    summary: v.string(),
    payload: v.string(),
  })
    .index("by_gameId", ["gameId"])
    .index("by_gameId_and_turnNumber", ["gameId", "turnNumber"])
    .index("by_gameId_and_eventType", ["gameId", "eventType"]),

  cmb_battles: defineTable({
    gameId: v.id("sim_games"),
    systemId: v.id("gal_systems"),
    attackerEmpireId: v.id("emp_states"),
    defenderEmpireId: v.id("emp_states"),
    attackerFleetId: v.id("flt_fleets"),
    defenderFleetId: v.id("flt_fleets"),
    originalOwnerEmpireId: v.union(v.id("emp_states"), v.null()),
    retreatTargetSystemId: v.id("gal_systems"),
    status: v.union(v.literal("active"), v.literal("resolved")),
    phase: v.union(
      v.literal("opening"),
      v.literal("awaitingAttackerDecision"),
      v.literal("retreating"),
      v.literal("resolved"),
    ),
    roundNumber: v.number(),
    startedTurn: v.number(),
    updatedTurn: v.number(),
  })
    .index("by_gameId", ["gameId"])
    .index("by_gameId_and_status", ["gameId", "status"])
    .index("by_gameId_and_systemId_and_status", ["gameId", "systemId", "status"]),

  usr_profiles: defineTable({
    userId: v.id("users"),
    displayName: v.string(),
    avatarUrl: v.union(v.string(), v.null()),
    timezone: v.union(v.string(), v.null()),
    analyticsConsent: v.boolean(),
  }).index("by_userId", ["userId"]),

  /**
   * Per-user default colors for empire roster slots. Keys match `emp_states.empireKey` for
   * scripted empires (e.g. aurora, iron) or `emp_states.npcPlayerKey` for catalog NPCs (e.g.
   * tomas-varek). Applied when that user creates or starts a game that runs map seeding.
   */
  usr_empire_color_prefs: defineTable({
    userId: v.id("users"),
    preferenceKey: v.string(),
    colorHex: v.string(),
  })
    .index("by_userId", ["userId"])
    .index("by_userId_and_preferenceKey", ["userId", "preferenceKey"]),

  usr_game_roles: defineTable({
    gameId: v.id("sim_games"),
    userId: v.id("users"),
    role: v.union(
      v.literal("observer"),
      v.literal("empire"),
      v.literal("trader"),
      v.literal("admin"),
    ),
    empireId: v.union(v.id("emp_states"), v.null()),
    joinedAt: v.number(),
    isActive: v.boolean(),
  })
    .index("by_gameId_and_userId", ["gameId", "userId"])
    .index("by_gameId_and_role", ["gameId", "role"]),

  gal_systems: defineTable({
    gameId: v.id("sim_games"),
    systemKey: v.string(),
    name: v.string(),
    x: v.number(),
    y: v.number(),
    resourceRichness: v.number(),
    /** 1–10; defaults from resourceRichness when absent. */
    baseProductivity: v.optional(v.number()),
    isHomeworld: v.boolean(),
    ownerEmpireId: v.union(v.id("emp_states"), v.null()),
    stockFood: v.optional(v.number()),
    stockWeapons: v.optional(v.number()),
    stockResearch: v.optional(v.number()),
    /** Headcount (people). UI uses k/M/B; max 100B; below 1k after a turn → abandoned. */
    population: v.optional(v.number()),
    /** Production emphasis sliders (should sum to 100). */
    emphasisFood: v.optional(v.number()),
    emphasisShips: v.optional(v.number()),
    emphasisResearch: v.optional(v.number()),
    recentBattleTurns: v.optional(v.number()),
    recentDamageFood: v.optional(v.number()),
    recentDamageWeapons: v.optional(v.number()),
    recentDamageResearch: v.optional(v.number()),
    recentDamagePopulation: v.optional(v.number()),
    taxBlockedUntilTurn: v.optional(v.number()),
    /** True while hostile fleets contest this system this turn (UI / diagnostics). */
    underAttack: v.optional(v.boolean()),
    /** Turn number when combat last occurred here; blocks tax that same turn (spec §12.2). */
    lastContestedTurn: v.optional(v.number()),
    /** Independent / breakaway treasury after empire collapse. */
    localTreasury: v.optional(v.number()),
    /**
     * When set and `currentTurn < traderBoycottUntilTurn`, background NPC traders refuse to
     * deliver or spawn voyages to this unowned system (it previously could not pay).
     *
     * Only applies when `ownerEmpireId === null`.
     */
    traderBoycottUntilTurn: v.optional(v.number()),
    /**
     * Local food market price (credits per food unit). Derived each turn from
     * stockFood vs demand. Low when surplus, high when scarce. Background traders
     * exploit differentials between systems.
     */
    foodPrice: v.optional(v.number()),
    /**
     * Extra credits per food unit the colony offers importers on top of {@link foodPrice}
     * (routing + payout). Paid from empire treasury or localTreasury when cargo arrives.
     */
    foodImportSubsidyPerUnit: v.optional(v.number()),
    /** Accumulated ship-production points toward a colony ship (homeworld build project). */
    colonyShipBuildProgress: v.optional(v.number()),
    /** Target ship points to complete one colony ship (set when build starts). */
    colonyShipBuildCost: v.optional(v.number()),
    /** When true, ship production diverts into colonyShipBuildProgress until cost is met. */
    colonyShipBuildEnabled: v.optional(v.boolean()),
    /** Flat food units added per turn from landed colony-ship infrastructure. */
    colonyFoodBonusPerTurn: v.optional(v.number()),
  })
    .index("by_gameId", ["gameId"])
    .index("by_gameId_and_systemKey", ["gameId", "systemKey"])
    .index("by_gameId_and_ownerEmpireId", ["gameId", "ownerEmpireId"]),

  /**
   * Player-built colony ships: non-combat, not in flt_fleets. Single-use until colonize.
   */
  col_colony_ships: defineTable({
    gameId: v.id("sim_games"),
    empireId: v.id("emp_states"),
    name: v.string(),
    originSystemId: v.id("gal_systems"),
    destinationSystemId: v.union(v.id("gal_systems"), v.null()),
    etaTurn: v.union(v.number(), v.null()),
    status: v.union(v.literal("idle"), v.literal("enRoute")),
    dispatchedTurn: v.optional(v.number()),
    travelTurnsTotal: v.optional(v.number()),
    /** Battle damage to mothership defenses while idle in a contested system; 50 destroys it. */
    mothershipDefenseDamage: v.optional(v.number()),
    /** After the current destination, further systems on this voyage (same dispatch). */
    routeRemainingSystemIds: v.optional(v.array(v.id("gal_systems"))),
  })
    .index("by_gameId", ["gameId"])
    .index("by_gameId_and_empireId", ["gameId", "empireId"])
    .index("by_gameId_and_status", ["gameId", "status"])
    .index("by_gameId_and_originSystemId_and_status", [
      "gameId",
      "originSystemId",
      "status",
    ]),

  gal_links: defineTable({
    gameId: v.id("sim_games"),
    fromSystemId: v.id("gal_systems"),
    toSystemId: v.id("gal_systems"),
    distance: v.number(),
    travelCost: v.number(),
  })
    .index("by_gameId", ["gameId"])
    .index("by_gameId_and_fromSystemId", ["gameId", "fromSystemId"]),

  emp_states: defineTable({
    gameId: v.id("sim_games"),
    empireKey: v.string(),
    name: v.string(),
    colorHex: v.string(),
    treasury: v.number(),
    /** Legacy aggregate; canonical food is per-system stockFood. Kept in sync with sum(system.stockFood). */
    foodStockpile: v.number(),
    /** Cached sum of owned systems’ population headcount; updated each turn. */
    population: v.number(),
    stability: v.number(),
    isCollapsed: v.boolean(),
    homeSystemId: v.union(v.id("gal_systems"), v.null()),
    techLevel: v.optional(v.number()),
    researchPool: v.optional(v.number()),
    insolvencyTurns: v.optional(v.number()),
    pauseBudgetSeconds: v.optional(v.number()),
    lastPauseRefreshAt: v.optional(v.number()),
    /** Empire-wide tax fraction 0–0.30; dampens local production and scales pop tax to treasury. */
    empireTaxRate: v.optional(v.number()),
    /** Human/player empires are commandable through usr_game_roles; NPC empires are sim-owned. */
    controller: v.optional(v.union(v.literal("human"), v.literal("npc"))),
    /** Roster key when this empire was created from the NPC empire player catalog. */
    npcPlayerKey: v.optional(v.string()),
    /** Display name for the player or NPC persona controlling this empire. */
    playerName: v.optional(v.string()),
    /** Editable automation brain for NPCs or humans that opt into scripted empire management. */
    strategyJson: v.optional(v.string()),
    /**
     * When set and `currentTurn < traderBoycottUntilTurn`, background NPC traders refuse to
     * deliver or spawn voyages to systems owned by this empire (they previously could not pay).
     */
    traderBoycottUntilTurn: v.optional(v.number()),
  })
    .index("by_gameId", ["gameId"])
    .index("by_gameId_and_empireKey", ["gameId", "empireKey"]),

  emp_system_holdings: defineTable({
    gameId: v.id("sim_games"),
    empireId: v.id("emp_states"),
    systemId: v.id("gal_systems"),
    taxRate: v.number(),
    productionModifier: v.number(),
    unrest: v.number(),
  })
    .index("by_gameId", ["gameId"])
    .index("by_gameId_and_empireId", ["gameId", "empireId"])
    .index("by_gameId_and_systemId", ["gameId", "systemId"]),

  flt_fleets: defineTable({
    gameId: v.id("sim_games"),
    empireId: v.id("emp_states"),
    fleetKey: v.string(),
    name: v.string(),
    /** Ships in this fleet (also used as combat strength for now). */
    strength: v.number(),
    originSystemId: v.id("gal_systems"),
    destinationSystemId: v.union(v.id("gal_systems"), v.null()),
    etaTurn: v.union(v.number(), v.null()),
    status: v.union(v.literal("idle"), v.literal("enRoute"), v.literal("engaged")),
    /** Turn during which this fleet left port (move applied); used for travel animation math. */
    dispatchedTurn: v.optional(v.number()),
    /** Hyperspace hops for current voyage; cleared when idle. */
    travelTurnsTotal: v.optional(v.number()),
    /** System to fall back to if this fleet retreats from a battle after arrival. */
    retreatSystemId: v.optional(v.id("gal_systems")),
    activeBattleId: v.optional(v.id("cmb_battles")),
  })
    .index("by_gameId", ["gameId"])
    .index("by_gameId_and_empireId", ["gameId", "empireId"])
    .index("by_gameId_and_status", ["gameId", "status"])
    .index("by_gameId_and_empireId_and_originSystemId_and_status", [
      "gameId",
      "empireId",
      "originSystemId",
      "status",
    ]),

  flt_orders: defineTable({
    gameId: v.id("sim_games"),
    fleetId: v.id("flt_fleets"),
    issuedByUserId: v.id("users"),
    turnNumber: v.number(),
    orderType: v.union(v.literal("move"), v.literal("hold"), v.literal("retreat")),
    targetSystemId: v.union(v.id("gal_systems"), v.null()),
    /** Ships to send on a move order; omit to move the entire fleet. */
    shipCount: v.optional(v.number()),
    issuedAt: v.number(),
  })
    .index("by_gameId_and_turnNumber", ["gameId", "turnNumber"])
    .index("by_gameId_and_fleetId", ["gameId", "fleetId"]),

  /** Standing order: each turn after economy, dispatch a % of idle garrison along one hop. */
  flt_garrison_routes: defineTable({
    gameId: v.id("sim_games"),
    empireId: v.id("emp_states"),
    originSystemId: v.id("gal_systems"),
    destinationSystemId: v.id("gal_systems"),
    /** 1–100: share of combined idle garrison at origin to send toward destination. */
    dispatchPct: v.number(),
    enabled: v.boolean(),
    /** True when this standing order is maintained from an empire strategy brain. */
    managedByStrategy: v.optional(v.boolean()),
    strategyPurpose: v.optional(
      v.union(
        v.literal("earlyRush"),
        v.literal("borderReinforce"),
        v.literal("enemyAttack"),
      ),
    ),
    strategyUpdatedTurn: v.optional(v.number()),
  })
    .index("by_gameId", ["gameId"])
    .index("by_gameId_and_empireId", ["gameId", "empireId"])
    .index("by_gameId_and_originSystemId", ["gameId", "originSystemId"]),

  /**
   * Per-game god-mode multipliers set by admins. One row per game; missing row = all defaults (1.0).
   * Applied every turn in the economy, combat, and background-trade engines.
   */
  sim_game_settings: defineTable({
    gameId: v.id("sim_games"),
    /** Food production scaling (0.25–4.0, default 1.0). */
    foodProdMult: v.number(),
    /** Ship production scaling (0.25–4.0, default 1.0). */
    shipProdMult: v.number(),
    /** Population growth rate scaling (0.0–5.0, default 1.0). */
    popGrowthMult: v.number(),
    /** Tax income scaling per pop unit (0.0–3.0, default 1.0). */
    taxMult: v.number(),
    /** How strongly local food prices swing with supply/demand (0.25–4.0, default 1.0). */
    foodPriceElasticityMult: v.number(),
    /** Starvation death-rate scaling (0.0–5.0, default 1.0). */
    starvationMult: v.number(),
    /**
     * Max food price multiplier vs base during severe starvation (default 100×).
     * Slider typically 5–100; economy interpolates toward this cap as colonies starve.
     */
    starvationFoodPriceCapMult: v.optional(v.number()),
    /** Background trader ship-hire cost scaling (0.1–5.0, default 1.0). */
    traderShipCostMult: v.number(),
    /** Attacker damage dealt per round scaling (0.25–4.0, default 1.0). */
    combatAttackMult: v.number(),
    /** Defender damage dealt per round scaling (0.25–4.0, default 1.0). */
    combatDefendMult: v.number(),
    /** Collateral damage per battle round scaling (0.0–5.0, default 1.0). */
    collateralDamageMult: v.number(),

    // ─── Balance page settings ────────────────────────────────────────────────
    /** Minimum background NPC traders active at once (0–8, default 0). */
    traderMinActive: v.optional(v.number()),
    /** Maximum background NPC traders active at once (0–32, default 3 when automated). */
    traderMaxActive: v.optional(v.number()),
    /** Ship hire cost per travel-turn in credits (default 250). */
    traderShipHirePerTurn: v.optional(v.number()),
    /** Chance from 0-100 that an NPC accepts a viable job and hires a ship (default 20). */
    traderHireChancePct: v.optional(v.number()),
    /** One-time docking fee on trader arrival in credits (default 100). */
    traderDockingCost: v.optional(v.number()),
    /**
     * Food stockpile threshold above which prices fall as a multiple of demand.
     * e.g. 20.0 = when stock > 20× one-turn demand the market is in oversupply (default 20.0).
     */
    foodStockpileMaxPerPop: v.optional(v.number()),
    /**
     * Food stockpile threshold below which food stress activates, as a multiple of demand.
     * e.g. 1.5 = when stock < 1.5× one-turn demand, prices rise sharply (default 1.5).
     */
    foodStockpileMinPerPop: v.optional(v.number()),
    /**
     * Food stress factor: multiplier on price growth rate when below the minimum stockpile.
     * 1.0 = standard 25 %/turn growth; 2.0 = 50 %/turn (default 1.0).
     */
    foodStressFactor: v.optional(v.number()),
    /**
     * Defender advantage ratio (replaces DEFENDER_BASE_MULTIPLIER).
     * 2.0 = default 2:1 advantage; range 0.5–9.0.
     */
    combatDefenderAdvantage: v.optional(v.number()),
    /**
     * Multiplier on the relative probability that collateral damage lands on food stockpiles.
     * 1.0 = default (35% of collateral hits); 0 = food is immune; 3.0 = food takes most hits.
     */
    combatFoodDamageMult: v.optional(v.number()),
    /**
     * Base food price per unit at equilibrium (stock ≈ demand). Integer credits.
     * All per-system food prices scale proportionally (default 6 cr).
     */
    foodBasePrice: v.optional(v.number()),
    /**
     * When true (default), min/max NPC trader counts are adjusted by the sim every 10 turns from delivery economics.
     * When false, Balance sliders control `traderMinActive` / `traderMaxActive` manually.
     */
    traderLimitsAutomated: v.optional(v.boolean()),
  }).index("by_gameId", ["gameId"]),

  /**
   * Per-game trader roster: named NPC pool (from catalog) and future human traders.
   * NPCs activate up to traderMaxActive with a starting treasury; bankruptcy when treasury falls below the configured floor.
   */
  sim_trader_identities: defineTable({
    gameId: v.id("sim_games"),
    /** Stable key into `seed/npcTraderCatalog` for NPCs; unique per game with `gameId`. */
    catalogKey: v.string(),
    kind: v.union(v.literal("npc"), v.literal("player")),
    displayName: v.string(),
    affiliation: v.string(),
    /** Lower activates first when refilling the active roster. */
    slotOrder: v.number(),
    state: v.union(
      v.literal("inactive"),
      v.literal("active"),
      v.literal("bankrupt"),
    ),
    treasury: v.number(),
    userId: v.union(v.id("users"), v.null()),
  })
    .index("by_gameId", ["gameId"])
    .index("by_gameId_and_state", ["gameId", "state"])
    .index("by_gameId_and_slotOrder", ["gameId", "slotOrder"]),

  eco_market_snapshots: defineTable({
    gameId: v.id("sim_games"),
    turnNumber: v.number(),
    commodity: v.string(),
    unitPrice: v.number(),
    volume: v.number(),
  })
    .index("by_gameId_and_turnNumber", ["gameId", "turnNumber"])
    .index("by_gameId_and_commodity", ["gameId", "commodity"]),

  eco_system_outputs: defineTable({
    gameId: v.id("sim_games"),
    systemId: v.id("gal_systems"),
    turnNumber: v.number(),
    commodity: v.string(),
    produced: v.number(),
    consumed: v.number(),
  })
    .index("by_gameId_and_systemId", ["gameId", "systemId"])
    .index("by_gameId_and_turnNumber", ["gameId", "turnNumber"]),

  /**
   * Background NPC trader voyages. Each record represents one autonomous cargo run:
   * food loaded at origin, transported to destination, sold on arrival.
   * Traders are self-financing — profit = (sellPrice - buyPrice) × cargo - shipCosts.
   * Automated spawns use shortest-path lane routes (multi-hop) and a minimum revenue÷cost ratio.
   */
  eco_bg_traders: defineTable({
    gameId: v.id("sim_games"),
    /** Named captain / company running this voyage (NPC pool); absent on legacy rows. */
    traderIdentityId: v.optional(v.id("sim_trader_identities")),
    originSystemId: v.id("gal_systems"),
    destinationSystemId: v.id("gal_systems"),
    commodity: v.string(),
    /** Food units in transit; deducted from origin on dispatch (from oversupply only), added to dest on arrival. */
    cargoUnits: v.number(),
    /** Price paid per unit at origin (credits). */
    boughtAtPrice: v.number(),
    /** Total travel turns for this hop. */
    travelTurns: v.number(),
    /** Turn when the cargo arrives at destination. */
    etaTurn: v.number(),
    /** Turn when the trader was created. */
    dispatchedTurn: v.number(),
    /** Ship hire cost per turn of travel (credits). */
    shipHireCostPerTurn: v.number(),
    /** Net credits to the trader on delivery (sale − purchase − voyage cost); set when status becomes delivered. */
    deliveryProfit: v.optional(v.number()),
    /** Turn when the voyage completed (`status` → delivered); used for automated NPC trader limit reviews. */
    deliveredTurn: v.optional(v.number()),
    /** Credits received from the destination payer on delivery (before subtracting costs). */
    deliveryRevenue: v.optional(v.number()),
    /** Purchase + ship hire + docking costs for this voyage (credits). */
    deliveryCost: v.optional(v.number()),
    /** Commodity purchase at origin (credits): cargoUnits × boughtAtPrice. */
    deliveryPurchaseCredits: v.optional(v.number()),
    /** Ship hire only (credits): shipHireCostPerTurn × travelTurns. */
    deliveryShipHireTotal: v.optional(v.number()),
    /** Docking fee paid on arrival (from Balance settings at delivery time). */
    deliveryDockingFee: v.optional(v.number()),
    /**
     * Food: per-unit market clearing price at destination after **all** same-turn food
     * to this system is applied (batch settlement).
     */
    deliveryClearingUnitPrice: v.optional(v.number()),
    /** Food: per-unit price if the buyer paid subsidy + clearing in full (invoice basis). */
    deliveryNominalUnitPrice: v.optional(v.number()),
    /** Full nominal payment owed to this captain for the cargo (before treasury cap). */
    deliveryInvoiceCredits: v.optional(v.number()),
    /** max(0, invoice − actual credits received) — buyer treasury ran dry or batch-split shortfall. */
    deliveryTreasuryShortfall: v.optional(v.number()),
    /** True when the destination could not pay the full invoice (trader short-changed). */
    deliveryBuyerUnderpaid: v.optional(v.boolean()),
    status: v.union(
      v.literal("enRoute"),
      v.literal("delivered"),
      v.literal("cancelled"),
    ),
  })
    .index("by_gameId_and_status", ["gameId", "status"])
    .index("by_gameId_and_etaTurn_and_status", ["gameId", "etaTurn", "status"])
    .index("by_gameId_and_destinationSystemId_and_status", [
      "gameId",
      "destinationSystemId",
      "status",
    ])
    .index("by_gameId_and_deliveredTurn", ["gameId", "deliveredTurn"]),

  trd_charters: defineTable({
    gameId: v.id("sim_games"),
    issuerEmpireId: v.id("emp_states"),
    traderUserId: v.id("users"),
    routeStartSystemId: v.id("gal_systems"),
    routeEndSystemId: v.id("gal_systems"),
    baseRate: v.number(),
    status: v.union(v.literal("open"), v.literal("active"), v.literal("closed")),
  })
    .index("by_gameId_and_traderUserId", ["gameId", "traderUserId"])
    .index("by_gameId_and_status", ["gameId", "status"]),

  trd_runs: defineTable({
    gameId: v.id("sim_games"),
    charterId: v.id("trd_charters"),
    turnNumber: v.number(),
    commodity: v.string(),
    unitsMoved: v.number(),
    payout: v.number(),
    success: v.boolean(),
  })
    .index("by_gameId_and_turnNumber", ["gameId", "turnNumber"])
    .index("by_gameId_and_charterId", ["gameId", "charterId"]),
});
