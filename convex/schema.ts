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
  }).index("by_status", ["status"]),

  sim_turns: defineTable({
    gameId: v.id("sim_games"),
    turnNumber: v.number(),
    startedAt: v.number(),
    resolvedAt: v.union(v.number(), v.null()),
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

  usr_profiles: defineTable({
    userId: v.id("users"),
    displayName: v.string(),
    avatarUrl: v.union(v.string(), v.null()),
    timezone: v.union(v.string(), v.null()),
    analyticsConsent: v.boolean(),
  }).index("by_userId", ["userId"]),

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
    isHomeworld: v.boolean(),
    ownerEmpireId: v.union(v.id("emp_states"), v.null()),
  })
    .index("by_gameId", ["gameId"])
    .index("by_gameId_and_systemKey", ["gameId", "systemKey"])
    .index("by_gameId_and_ownerEmpireId", ["gameId", "ownerEmpireId"]),

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
    foodStockpile: v.number(),
    population: v.number(),
    stability: v.number(),
    isCollapsed: v.boolean(),
    homeSystemId: v.union(v.id("gal_systems"), v.null()),
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
    .index("by_gameId_and_empireId", ["gameId", "empireId"])
    .index("by_gameId_and_systemId", ["gameId", "systemId"]),

  flt_fleets: defineTable({
    gameId: v.id("sim_games"),
    empireId: v.id("emp_states"),
    fleetKey: v.string(),
    name: v.string(),
    strength: v.number(),
    originSystemId: v.id("gal_systems"),
    destinationSystemId: v.union(v.id("gal_systems"), v.null()),
    etaTurn: v.union(v.number(), v.null()),
    status: v.union(v.literal("idle"), v.literal("enRoute"), v.literal("engaged")),
  })
    .index("by_gameId", ["gameId"])
    .index("by_gameId_and_empireId", ["gameId", "empireId"])
    .index("by_gameId_and_status", ["gameId", "status"]),

  flt_orders: defineTable({
    gameId: v.id("sim_games"),
    fleetId: v.id("flt_fleets"),
    issuedByUserId: v.id("users"),
    turnNumber: v.number(),
    orderType: v.union(v.literal("move"), v.literal("hold"), v.literal("retreat")),
    targetSystemId: v.union(v.id("gal_systems"), v.null()),
    issuedAt: v.number(),
  })
    .index("by_gameId_and_turnNumber", ["gameId", "turnNumber"])
    .index("by_gameId_and_fleetId", ["gameId", "fleetId"]),

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
