import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { authTables } from "@convex-dev/auth/server";

export default defineSchema({
  ...authTables,
  // Extend the auth users table with a custom admin flag.
  // Spreading authTables first and then overriding `users` gives us the extra field
  // while preserving all required auth indexes.
  users: defineTable({
    name: v.optional(v.string()),
    email: v.optional(v.string()),
    phone: v.optional(v.string()),
    image: v.optional(v.string()),
    emailVerificationTime: v.optional(v.number()),
    phoneVerificationTime: v.optional(v.number()),
    isAnonymous: v.optional(v.boolean()),
    admin: v.optional(v.boolean()),
  })
    .index("email", ["email"])
    .index("phone", ["phone"]),
  sim_games: defineTable({
    name: v.string(),
    urlCode: v.optional(v.string()),
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
    createdByUserId: v.id("users"),
    ownerUserId: v.union(v.id("users"), v.null()),
    missionKey: v.optional(v.union(v.string(), v.null())),
    lobbyScenarioKey: v.union(v.string(), v.null()),
    missionAppliedAt: v.optional(v.number()),
    startedAt: v.union(v.number(), v.null()),
    endedAt: v.union(v.number(), v.null()),
    winnerEmpireKey: v.union(v.string(), v.null()),
    finalizationState: v.optional(
      v.union(
        v.literal("none"),
        v.literal("pending_result_write"),
        v.literal("results_written"),
        v.literal("pending_cleanup"),
        v.literal("cleaned"),
        v.literal("archived_debug"),
      ),
    ),
    retentionClass: v.optional(
      v.union(
        v.literal("discarded"),
        v.literal("official"),
        v.literal("archived_debug"),
      ),
    ),
    finishReason: v.optional(
      v.union(
        v.literal("last_empire_standing"),
        v.literal("abandoned_scored"),
        v.literal("admin_terminated_discarded"),
        v.literal("admin_terminated_scored"),
      ),
    ),
    lastMeaningfulActivityAt: v.optional(v.number()),
    lastHumanActionAt: v.optional(v.number()),
    lastResolvedTurnAt: v.optional(v.number()),
    abandonmentEligibleAt: v.optional(v.number()),
    abandonedAt: v.optional(v.number()),
    cleanupQueuedAt: v.optional(v.number()),
    cleanupCompletedAt: v.optional(v.number()),
    /** Exact real-time timestamp when the visible turn clock was paused. */
    turnPausedAtMs: v.optional(v.number()),
    /** Global turn timer pause (real-time ms); cron skips resolve while Date.now() < this. */
    turnPausedUntilMs: v.optional(v.number()),
    /**
    * When true, the StarStrat cron does not auto-start turn resolution for this game.
     * Status stays `running`; manual “Step turn” still works. Use to isolate a broken sim.
     */
    simCronTurnsDisabled: v.optional(v.boolean()),
    /**
     * If set (0–1), when the current turn finishes resolving the next open turn will set
     * `turnPausedUntilMs` so resolution cannot start until this fraction of `turnDurationMs`
     * has elapsed (player-chosen “execute after this point in the following turn’s window”).
     */
    nextTurnAutoResolveDelayRatio: v.optional(v.number()),
    /** Selected NPC empire roster keys to seed when the map is created. */
    npcEmpireKeys: v.optional(v.array(v.string())),
  })
    .index("by_urlCode", ["urlCode"])
    .index("by_status", ["status"])
    .index("by_createdByUserId", ["createdByUserId"])
    .index("by_ownerUserId", ["ownerUserId"])
    .index("by_ownerUserId_and_missionKey", ["ownerUserId", "missionKey"])
    .index("by_finalizationState", ["finalizationState"])
    .index("by_status_and_lastMeaningfulActivityAt", ["status", "lastMeaningfulActivityAt"])
    .index("by_ownerUserId_and_lobbyScenarioKey", ["ownerUserId", "lobbyScenarioKey"]),

  sim_missions: defineTable({
    key: v.string(),
    name: v.string(),
    description: v.string(),
    mapKey: v.string(),
    level: v.number(),
    requiredWins: v.number(),
    prerequisiteMissionKeys: v.array(v.string()),
    published: v.boolean(),
    sortOrder: v.number(),
    retentionClass: v.union(
      v.literal("discarded"),
      v.literal("official"),
      v.literal("archived_debug"),
    ),
    scenarioJson: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_key", ["key"])
    .index("by_published_and_sortOrder", ["published", "sortOrder"])
    .index("by_level_and_sortOrder", ["level", "sortOrder"]),

  sim_game_results: defineTable({
    gameId: v.id("sim_games"),
    name: v.string(),
    mapKey: v.string(),
    missionKey: v.optional(v.union(v.string(), v.null())),
    lobbyScenarioKey: v.union(v.string(), v.null()),
    seed: v.string(),
    startedAt: v.union(v.number(), v.null()),
    endedAt: v.number(),
    lastResolvedTurnNumber: v.number(),
    retentionClass: v.union(
      v.literal("discarded"),
      v.literal("official"),
      v.literal("archived_debug"),
    ),
    isOfficial: v.boolean(),
    finishReason: v.union(
      v.literal("last_empire_standing"),
      v.literal("abandoned_scored"),
      v.literal("admin_terminated_discarded"),
      v.literal("admin_terminated_scored"),
    ),
    winnerEmpireKey: v.union(v.string(), v.null()),
    winnerEmpireResultId: v.union(v.id("emp_results"), v.null()),
    winnerControllerKind: v.union(
      v.literal("human"),
      v.literal("npc"),
      v.null(),
    ),
    winnerUserId: v.union(v.id("users"), v.null()),
    winnerNpcPlayerKey: v.union(v.string(), v.null()),
    winningStarsControlled: v.optional(v.number()),
    winningFleetStrength: v.optional(v.number()),
    empireCount: v.number(),
    humanEmpireCount: v.number(),
    npcEmpireCount: v.number(),
    summaryJson: v.optional(v.string()),
  })
    .index("by_gameId", ["gameId"])
    .index("by_missionKey", ["missionKey"])
    .index("by_isOfficial_and_endedAt", ["isOfficial", "endedAt"])
    .index("by_winnerUserId", ["winnerUserId"])
    .index("by_winnerNpcPlayerKey", ["winnerNpcPlayerKey"]),

  emp_results: defineTable({
    gameResultId: v.id("sim_game_results"),
    gameId: v.id("sim_games"),
    empireId: v.union(v.id("emp_states"), v.null()),
    empireKey: v.string(),
    empireName: v.string(),
    colorHex: v.string(),
    controllerKind: v.union(v.literal("human"), v.literal("npc")),
    userId: v.union(v.id("users"), v.null()),
    npcPlayerKey: v.union(v.string(), v.null()),
    playerName: v.union(v.string(), v.null()),
    strategyJson: v.union(v.string(), v.null()),
    strategySummaryJson: v.union(v.string(), v.null()),
    strategyFingerprint: v.union(v.string(), v.null()),
    strategyLibraryKey: v.union(v.string(), v.null()),
    strategySourceKind: v.union(
      v.literal("manual"),
      v.literal("library"),
      v.literal("custom"),
      v.literal("npc_default"),
      v.null(),
    ),
    placement: v.number(),
    isWinner: v.boolean(),
    eliminated: v.boolean(),
    eliminatedAtTurn: v.union(v.number(), v.null()),
    eliminationReason: v.union(
      v.literal("destroyed"),
      v.literal("collapsed"),
      v.literal("abandoned"),
      v.literal("survived_to_score"),
      v.null(),
    ),
    starsControlledFinal: v.number(),
    populationFinal: v.number(),
    fleetCountFinal: v.number(),
    fleetStrengthFinal: v.number(),
    treasuryFinal: v.number(),
    researchPoolFinal: v.number(),
    homeSystemSurvived: v.boolean(),
    scoreFinal: v.number(),
    scoreBreakdownJson: v.optional(v.string()),
  })
    .index("by_gameResultId", ["gameResultId"])
    .index("by_gameId", ["gameId"])
    .index("by_userId_and_isWinner", ["userId", "isWinner"])
    .index("by_npcPlayerKey_and_isWinner", ["npcPlayerKey", "isWinner"])
    .index("by_strategyFingerprint_and_isWinner", ["strategyFingerprint", "isWinner"])
    .index("by_strategyLibraryKey_and_isWinner", ["strategyLibraryKey", "isWinner"]),

  sim_turns: defineTable({
    gameId: v.id("sim_games"),
    turnNumber: v.number(),
    startedAt: v.number(),
    preparedAt: v.optional(v.number()),
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
      v.literal("preparing"),
      v.literal("prepared"),
      v.literal("resolved"),
    ),
  })
    .index("by_gameId", ["gameId"])
    .index("by_gameId_and_turnNumber", ["gameId", "turnNumber"]),

  sim_turn_preparations: defineTable({
    gameId: v.id("sim_games"),
    turnNumber: v.number(),
    targetBoundaryAt: v.number(),
    state: v.union(
      v.literal("queued"),
      v.literal("preparing"),
      v.literal("prepared"),
      v.literal("committed"),
      v.literal("stale"),
    ),
    requestedAt: v.number(),
    startedAt: v.optional(v.number()),
    preparedAt: v.optional(v.number()),
    committedAt: v.optional(v.number()),
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
    summaryJson: v.optional(v.string()),
  })
    .index("by_gameId", ["gameId"])
    .index("by_gameId_and_turnNumber", ["gameId", "turnNumber"])
    .index("by_gameId_and_state", ["gameId", "state"]),

  sim_turn_preparation_ops: defineTable({
    preparationId: v.id("sim_turn_preparations"),
    gameId: v.id("sim_games"),
    turnNumber: v.number(),
    opOrder: v.number(),
    tableName: v.string(),
    opType: v.union(v.literal("insert"), v.literal("patch"), v.literal("delete")),
    targetId: v.optional(v.string()),
    payloadJson: v.optional(v.string()),
  })
    .index("by_preparationId_and_opOrder", ["preparationId", "opOrder"])
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
    /** Multi-empire battles keep one merged fleet per attacking empire. */
    attackerFleetIds: v.optional(v.array(v.id("flt_fleets"))),
    /** Reserved for symmetry/future-proofing; currently a battle has one defending empire. */
    defenderFleetIds: v.optional(v.array(v.id("flt_fleets"))),
    originalOwnerEmpireId: v.union(v.id("emp_states"), v.null()),
    /** Deprecated: kept optional for old battle rows created before retreat was removed. */
    retreatTargetSystemId: v.optional(v.id("gal_systems")),
    status: v.union(v.literal("active"), v.literal("resolved")),
    phase: v.union(
      v.literal("opening"),
      v.literal("awaitingAttackerDecision"),
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
    /** The user's preferred starting strategy profile, applied at game start when shown the ready modal. */
    defaultStartingStrategyProfileId: v.optional(v.id("usr_automation_profiles")),
  }).index("by_userId", ["userId"]),

  /**
   * User-owned automation profile library. Profiles may be custom or derived from the public
   * library with saved numeric overrides. `strategyJson` is always the effective strategy that can
   * be applied directly to an empire.
   */
  usr_automation_profiles: defineTable({
    userId: v.id("users"),
    name: v.string(),
    description: v.optional(v.string()),
    isActive: v.optional(v.boolean()),
    sourceKind: v.union(v.literal("custom"), v.literal("library")),
    sourceLibraryKey: v.optional(v.string()),
    overridesJson: v.optional(v.string()),
    strategyJson: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
    lastUsedAt: v.optional(v.number()),
  })
    .index("by_userId", ["userId"])
    .index("by_userId_and_name", ["userId", "name"]),

  /**
   * Shared automation strategy catalog. Built-in strategies are seeded here from
   * `convex/usr/automationStrategyLibrary.ts` and can then be edited in-place by admins.
   */
  usr_automation_strategies: defineTable({
    key: v.string(),
    name: v.string(),
    description: v.string(),
    tags: v.array(v.string()),
    strategyJson: v.string(),
    availableForHumans: v.boolean(),
    availableForNpcs: v.boolean(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_key", ["key"])
    .index("by_availableForHumans", ["availableForHumans"])
    .index("by_availableForNpcs", ["availableForNpcs"]),

  /** Shared empire NPC catalog used by admin tooling and game seeding. */
  emp_npc_players: defineTable({
    key: v.string(),
    playerName: v.string(),
    empireName: v.string(),
    colorHex: v.string(),
    strategyLibraryKey: v.union(v.string(), v.null()),
    isActive: v.boolean(),
    sortOrder: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_key", ["key"])
    .index("by_isActive_and_sortOrder", ["isActive", "sortOrder"]),

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
    .index("by_userId", ["userId"])
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
    /**
     * Per-system treasury. Systems collect local tax share, docking fees, and origin-sale
     * commodity revenue. Independent systems use it as their only buyer treasury; owned
     * systems can spend it as an emergency top-up for imports when the empire treasury
     * cannot cover the full invoice.
     */
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
    /** Consecutive economy turns where this system could not meet local food demand. */
    foodShortageTurns: v.optional(v.number()),
    /** Most recent turn where this system could not meet local food demand. */
    lastFoodShortageTurn: v.optional(v.number()),
    /** Length of the most recent food-shortage streak. */
    lastFoodShortageTurns: v.optional(v.number()),
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
    /** How an NPC empire's automation becomes active. Human automation ignores this and runs immediately. */
    strategyStartMode: v.optional(
      v.union(v.literal("turn"), v.literal("attacked")),
    ),
    /** First turn when a turn-gated NPC strategy may begin. */
    strategyStartTurn: v.optional(v.number()),
    /** Latched turn when an NPC strategy first became active. */
    strategyActivatedAtTurn: v.optional(v.number()),
    /** Timestamp when this empire asked for its standing orders to be cleared and replanned. */
    standingOrdersRefreshRequestedAt: v.optional(v.number()),
    /**
     * When set and `currentTurn < traderBoycottUntilTurn`, background NPC traders refuse to
     * deliver or spawn voyages to systems owned by this empire (they previously could not pay).
     */
    traderBoycottUntilTurn: v.optional(v.number()),
    /**
     * Optional manual overrides for the five strategic posture sliders.
     * Omitted keys use defaults derived from `strategyJson` each turn.
     */
    strategicSliderOverrides: v.optional(
      v.object({
        militaryAggression: v.optional(
          v.union(
            v.literal("lowest"),
            v.literal("low"),
            v.literal("medium"),
            v.literal("high"),
            v.literal("highest"),
          ),
        ),
        expansion: v.optional(
          v.union(
            v.literal("lowest"),
            v.literal("low"),
            v.literal("medium"),
            v.literal("high"),
            v.literal("highest"),
          ),
        ),
        defensivePosture: v.optional(
          v.union(
            v.literal("lowest"),
            v.literal("low"),
            v.literal("medium"),
            v.literal("high"),
            v.literal("highest"),
          ),
        ),
        priorityOperations: v.optional(
          v.union(
            v.literal("lowest"),
            v.literal("low"),
            v.literal("medium"),
            v.literal("high"),
            v.literal("highest"),
          ),
        ),
        economicMobilization: v.optional(
          v.union(
            v.literal("lowest"),
            v.literal("low"),
            v.literal("medium"),
            v.literal("high"),
            v.literal("highest"),
          ),
        ),
      }),
    ),
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

  emp_priority_stars: defineTable({
    gameId: v.id("sim_games"),
    empireId: v.id("emp_states"),
    systemId: v.id("gal_systems"),
    createdByUserId: v.id("users"),
    createdAt: v.number(),
  })
    .index("by_gameId", ["gameId"])
    .index("by_gameId_and_empireId", ["gameId", "empireId"])
    .index("by_gameId_and_empireId_and_systemId", ["gameId", "empireId", "systemId"]),

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
    /** Deprecated: old fallback target from the removed retreat order flow. */
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
    orderType: v.union(v.literal("move"), v.literal("hold")),
    targetSystemId: v.union(v.id("gal_systems"), v.null()),
    /** Ships to send on a move order; omit to move the entire fleet. */
    shipCount: v.optional(v.number()),
    issuedAt: v.number(),
    /** Set once movement has consumed this order; kept through later automation phases as a manual lock. */
    movementAppliedAt: v.optional(v.number()),
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
    /** When true, empire strategy maintains this route; false/omitted = player standing order. */
    managedByStrategy: v.optional(v.boolean()),
    /** Consecutive route-application turns where the origin was not owned or the destination was missing. */
    ownershipInvalidTurns: v.optional(v.number()),
    strategyPurpose: v.optional(
      v.union(
        v.literal("emergencyReinforce"),
        v.literal("priorityOwnedCorridor"),
        v.literal("priorityNeutralTarget"),
        v.literal("priorityEnemyStaging"),
        v.literal("priorityEnemyAttack"),
        v.literal("priorityApproach"),
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
   * Per-game god-mode/balance settings set by admins. One row per game; missing row = current defaults.
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
    /**
     * Power curve applied to local ship-emphasis share. 1.0 = linear old behavior;
     * 1.8 = default specialization bonus; 3.0 = extreme specialization.
     */
    shipProdEmphasisPower: v.optional(v.number()),

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
     * For owned destinations, credits per 100 cr of unpaid trader invoice that the
     * system local treasury may add after the empire treasury runs short (default 50).
     */
    localTreasuryAddsPer100Cr: v.optional(v.number()),
    /**
     * Food stockpile threshold above which prices fall as a multiple of demand.
     * e.g. 20.0 = when stock > 20× one-turn demand the market is in oversupply (default 20.0).
     */
    foodStockpileMaxPerPop: v.optional(v.number()),
    /**
     * Food stockpile threshold below which food stress activates, as a multiple of demand.
     * e.g. 2.0 = when stock < 2× one-turn demand, prices rise sharply (default 2.0).
     */
    foodStockpileMinPerPop: v.optional(v.number()),
    /**
     * Food stress factor: multiplier on price growth rate when below the minimum stockpile.
     * 1.0 = standard 25 %/turn growth; 2.0 = 50 %/turn (default 1.0).
     */
    foodStressFactor: v.optional(v.number()),
    /**
     * Defender advantage ratio (replaces DEFENDER_BASE_MULTIPLIER).
     * 3.0 = default 3:1 advantage; range 0.5–9.0.
     */
    combatDefenderAdvantage: v.optional(v.number()),
    /**
     * Multiplier on the relative probability that collateral damage lands on food stockpiles.
     * 4.0 = default and food takes most hits; 0 = food is immune.
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
    .index("by_gameId_and_userId", ["gameId", "userId"])
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
     * Food: per-unit market clearing price at destination when the cargo is sold
     * (before delivered food updates the next visible local price).
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
    traderIdentityId: v.id("sim_trader_identities"),
    routeStartSystemId: v.id("gal_systems"),
    routeEndSystemId: v.id("gal_systems"),
    baseRate: v.number(),
    status: v.union(v.literal("open"), v.literal("active"), v.literal("closed")),
  })
    .index("by_gameId_and_traderIdentityId", ["gameId", "traderIdentityId"])
    .index("by_gameId_and_status", ["gameId", "status"]),

  trd_runs: defineTable({
    gameId: v.id("sim_games"),
    charterId: v.id("trd_charters"),
    traderIdentityId: v.id("sim_trader_identities"),
    turnNumber: v.number(),
    commodity: v.string(),
    unitsMoved: v.number(),
    payout: v.number(),
    success: v.boolean(),
  })
    .index("by_gameId_and_turnNumber", ["gameId", "turnNumber"])
    .index("by_gameId_and_traderIdentityId", ["gameId", "traderIdentityId"])
    .index("by_gameId_and_charterId", ["gameId", "charterId"]),
});
