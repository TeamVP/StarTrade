import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx } from "../../_generated/server";
import { internalMutation } from "../../_generated/server";
import { v } from "convex/values";
import { applyGarrisonRoutes } from "../garrisonRoutes";

type StrategyEconomy = {
  taxRateTarget?: number;
  emphasisFood?: number;
  emphasisShips?: number;
  emphasisResearch?: number;
  foodSubsidyEnabled?: boolean;
  foodSubsidyPerUnit?: number;
};

type NeutralWorldPriority = "nearest" | "richest" | "weakestDefended";
type BorderStance = "passive" | "defensive" | "balanced" | "aggressive" | "warlike";
type StrategyPurpose = "earlyRush" | "borderReinforce" | "enemyAttack";

type StrategyAutomation = {
  earlyRush: boolean;
  neutralWorldPriority: NeutralWorldPriority;
  reserveShipsPct: number;
  moveDeepFleetsToBorder: boolean;
  borderReserveShipsPct: number;
  stance: BorderStance;
  attackAdvantageRequired: number;
};

type DesiredRoute = {
  originSystemId: Id<"gal_systems">;
  destinationSystemId: Id<"gal_systems">;
  dispatchPct: number;
  purpose: StrategyPurpose;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function readString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function readBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function parseStrategy(strategyJson: string): Record<string, unknown> | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(strategyJson);
  } catch {
    return null;
  }
  return asRecord(parsed);
}

function parseEconomy(strategyJson: string): StrategyEconomy | null {
  const strategy = parseStrategy(strategyJson);
  const rawEconomy = strategy === null ? null : asRecord(strategy.economy);
  if (rawEconomy === null) {
    return null;
  }

  return {
    taxRateTarget: finiteNumber(rawEconomy.taxRateTarget) ?? undefined,
    emphasisFood: finiteNumber(rawEconomy.emphasisFood) ?? undefined,
    emphasisShips: finiteNumber(rawEconomy.emphasisShips) ?? undefined,
    emphasisResearch: finiteNumber(rawEconomy.emphasisResearch) ?? undefined,
    foodSubsidyEnabled:
      typeof rawEconomy.foodSubsidyEnabled === "boolean"
        ? rawEconomy.foodSubsidyEnabled
        : undefined,
    foodSubsidyPerUnit: finiteNumber(rawEconomy.foodSubsidyPerUnit) ?? undefined,
  };
}

function parseAutomation(strategyJson: string): StrategyAutomation | null {
  const strategy = parseStrategy(strategyJson);
  if (strategy === null) {
    return null;
  }

  const expansion = asRecord(strategy.expansion) ?? {};
  const fleetPosture = asRecord(strategy.fleetPosture) ?? {};
  const borderPolicy = asRecord(strategy.borderPolicy) ?? {};
  const military = asRecord(strategy.military) ?? {};

  const neutralWorldPriority = readString(expansion.neutralWorldPriority);
  const rawStance = readString(borderPolicy.stance) ?? readString(military.aggressionLevel);
  const stance: BorderStance =
    rawStance === "passive" ||
    rawStance === "defensive" ||
    rawStance === "balanced" ||
    rawStance === "aggressive" ||
    rawStance === "warlike"
      ? rawStance
      : "balanced";

  const defaultAttackAdvantage =
    stance === "warlike" ? 0.8 : stance === "aggressive" ? 1 : stance === "balanced" ? 4 : 999;
  const rawAttackAdvantage = finiteNumber(borderPolicy.attackAdvantageRequired);

  return {
    earlyRush:
      readBoolean(expansion.earlyRush) ??
      readBoolean(expansion.colonizationEnabled) ??
      false,
    neutralWorldPriority:
      neutralWorldPriority === "richest" ||
      neutralWorldPriority === "weakestDefended" ||
      neutralWorldPriority === "nearest"
        ? neutralWorldPriority
        : "nearest",
    reserveShipsPct: clamp(finiteNumber(expansion.reserveShipsPct) ?? 30, 0, 95),
    moveDeepFleetsToBorder: readBoolean(fleetPosture.moveDeepFleetsToBorder) ?? true,
    borderReserveShipsPct: clamp(
      finiteNumber(fleetPosture.borderReserveShipsPct) ?? 40,
      0,
      95,
    ),
    stance,
    attackAdvantageRequired: clamp(rawAttackAdvantage ?? defaultAttackAdvantage, 0.5, 20),
  };
}

async function applyEconomyStrategyToEmpire(
  ctx: MutationCtx,
  params: {
    gameId: Id<"sim_games">;
    empire: Doc<"emp_states">;
    economy: StrategyEconomy;
    ownedSystems: Doc<"gal_systems">[];
  },
): Promise<void> {
  const empirePatch: { empireTaxRate?: number } = {};
  if (params.economy.taxRateTarget !== undefined) {
    const nextTaxRate = clamp(params.economy.taxRateTarget, 0, 0.3);
    if (params.empire.empireTaxRate !== nextTaxRate) {
      empirePatch.empireTaxRate = nextTaxRate;
    }
  }
  if (empirePatch.empireTaxRate !== undefined) {
    await ctx.db.patch("emp_states", params.empire._id, empirePatch);
  }

  const systemPatch: {
    emphasisFood?: number;
    emphasisShips?: number;
    emphasisResearch?: number;
    foodImportSubsidyPerUnit?: number;
  } = {};

  if (params.economy.emphasisFood !== undefined) {
    systemPatch.emphasisFood = clamp(Math.round(params.economy.emphasisFood), 0, 100);
  }
  if (params.economy.emphasisShips !== undefined) {
    systemPatch.emphasisShips = clamp(Math.round(params.economy.emphasisShips), 0, 100);
  }
  if (params.economy.emphasisResearch !== undefined) {
    systemPatch.emphasisResearch = clamp(
      Math.round(params.economy.emphasisResearch),
      0,
      100,
    );
  }
  if (params.economy.foodSubsidyEnabled !== undefined) {
    systemPatch.foodImportSubsidyPerUnit = params.economy.foodSubsidyEnabled
      ? clamp(params.economy.foodSubsidyPerUnit ?? 0, 0, 1_000)
      : 0;
  }

  if (Object.keys(systemPatch).length === 0) {
    return;
  }

  for (const system of params.ownedSystems) {
    const patch: typeof systemPatch = {};
    if (
      systemPatch.emphasisFood !== undefined &&
      system.emphasisFood !== systemPatch.emphasisFood
    ) {
      patch.emphasisFood = systemPatch.emphasisFood;
    }
    if (
      systemPatch.emphasisShips !== undefined &&
      system.emphasisShips !== systemPatch.emphasisShips
    ) {
      patch.emphasisShips = systemPatch.emphasisShips;
    }
    if (
      systemPatch.emphasisResearch !== undefined &&
      system.emphasisResearch !== systemPatch.emphasisResearch
    ) {
      patch.emphasisResearch = systemPatch.emphasisResearch;
    }
    if (
      systemPatch.foodImportSubsidyPerUnit !== undefined &&
      system.foodImportSubsidyPerUnit !== systemPatch.foodImportSubsidyPerUnit
    ) {
      patch.foodImportSubsidyPerUnit = systemPatch.foodImportSubsidyPerUnit;
    }
    if (Object.keys(patch).length > 0) {
      await ctx.db.patch("gal_systems", system._id, patch);
    }
  }
}

function addAdjacency(
  adjacency: Map<string, Id<"gal_systems">[]>,
  from: Id<"gal_systems">,
  to: Id<"gal_systems">,
) {
  const existing = adjacency.get(from);
  if (existing === undefined) {
    adjacency.set(from, [to]);
  } else {
    existing.push(to);
  }
}

function buildAdjacency(links: Doc<"gal_links">[]): Map<string, Id<"gal_systems">[]> {
  const adjacency = new Map<string, Id<"gal_systems">[]>();
  for (const link of links) {
    addAdjacency(adjacency, link.fromSystemId, link.toSystemId);
    addAdjacency(adjacency, link.toSystemId, link.fromSystemId);
  }
  return adjacency;
}

function systemResourceScore(system: Doc<"gal_systems">): number {
  return system.baseProductivity ?? system.resourceRichness;
}

function fleetStrengthBySystem(
  fleets: Doc<"flt_fleets">[],
): Map<string, Map<string, number>> {
  const bySystem = new Map<string, Map<string, number>>();
  for (const fleet of fleets) {
    if (fleet.status !== "idle" || fleet.strength <= 0) continue;
    let systemMap = bySystem.get(fleet.originSystemId);
    if (systemMap === undefined) {
      systemMap = new Map<string, number>();
      bySystem.set(fleet.originSystemId, systemMap);
    }
    systemMap.set(fleet.empireId, (systemMap.get(fleet.empireId) ?? 0) + fleet.strength);
  }
  return bySystem;
}

function strengthAtSystemForEmpire(
  strengthBySystem: Map<string, Map<string, number>>,
  systemId: Id<"gal_systems">,
  empireId: Id<"emp_states">,
): number {
  return strengthBySystem.get(systemId)?.get(empireId) ?? 0;
}

function totalForeignStrengthAtSystem(
  strengthBySystem: Map<string, Map<string, number>>,
  systemId: Id<"gal_systems">,
  empireId: Id<"emp_states">,
): number {
  const systemMap = strengthBySystem.get(systemId);
  if (systemMap === undefined) return 0;
  let total = 0;
  for (const [otherEmpireId, strength] of systemMap) {
    if (otherEmpireId !== empireId) {
      total += strength;
    }
  }
  return total;
}

function firstHopTowardNearestBorder(params: {
  originSystemId: Id<"gal_systems">;
  borderSystemIds: Set<string>;
  ownedSystemIds: Set<string>;
  adjacency: Map<string, Id<"gal_systems">[]>;
}): Id<"gal_systems"> | null {
  const queue: Array<{ systemId: Id<"gal_systems">; firstHop: Id<"gal_systems"> | null }> = [
    { systemId: params.originSystemId, firstHop: null },
  ];
  const visited = new Set<string>([params.originSystemId]);

  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined) break;
    if (
      current.firstHop !== null &&
      params.borderSystemIds.has(current.systemId)
    ) {
      return current.firstHop;
    }

    const neighbors = params.adjacency.get(current.systemId) ?? [];
    for (const neighborId of neighbors) {
      if (visited.has(neighborId) || !params.ownedSystemIds.has(neighborId)) {
        continue;
      }
      visited.add(neighborId);
      queue.push({
        systemId: neighborId,
        firstHop: current.firstHop ?? neighborId,
      });
    }
  }

  return null;
}

function putDesiredRoute(
  desired: Map<string, DesiredRoute>,
  route: DesiredRoute,
) {
  if (!desired.has(route.originSystemId)) {
    desired.set(route.originSystemId, route);
  }
}

async function upsertStrategyRoutes(
  ctx: MutationCtx,
  params: {
    gameId: Id<"sim_games">;
    empireId: Id<"emp_states">;
    turnNumber: number;
    desiredRoutes: DesiredRoute[];
    existingRoutes: Doc<"flt_garrison_routes">[];
  },
): Promise<void> {
  const desiredByOrigin = new Map(
    params.desiredRoutes.map((route) => [route.originSystemId, route]),
  );

  for (const route of params.existingRoutes) {
    if (route.managedByStrategy !== true) continue;
    const desired = desiredByOrigin.get(route.originSystemId);
    if (desired === undefined) {
      await ctx.db.delete("flt_garrison_routes", route._id);
      continue;
    }

    const hasManualOverride = params.existingRoutes.some(
      (candidate) =>
        candidate._id !== route._id &&
        candidate.originSystemId === route.originSystemId &&
        candidate.managedByStrategy !== true,
    );
    if (hasManualOverride) {
      await ctx.db.delete("flt_garrison_routes", route._id);
      desiredByOrigin.delete(route.originSystemId);
      continue;
    }

    const patch: {
      destinationSystemId?: Id<"gal_systems">;
      dispatchPct?: number;
      enabled?: boolean;
      strategyPurpose?: StrategyPurpose;
      strategyUpdatedTurn?: number;
    } = {};
    if (route.destinationSystemId !== desired.destinationSystemId) {
      patch.destinationSystemId = desired.destinationSystemId;
    }
    if (route.dispatchPct !== desired.dispatchPct) {
      patch.dispatchPct = desired.dispatchPct;
    }
    if (!route.enabled) {
      patch.enabled = true;
    }
    if (route.strategyPurpose !== desired.purpose) {
      patch.strategyPurpose = desired.purpose;
    }
    if (route.strategyUpdatedTurn !== params.turnNumber) {
      patch.strategyUpdatedTurn = params.turnNumber;
    }
    if (Object.keys(patch).length > 0) {
      await ctx.db.patch("flt_garrison_routes", route._id, patch);
    }
    desiredByOrigin.delete(route.originSystemId);
  }

  for (const route of desiredByOrigin.values()) {
    const hasManualOverride = params.existingRoutes.some(
      (candidate) =>
        candidate.originSystemId === route.originSystemId &&
        candidate.managedByStrategy !== true,
    );
    if (hasManualOverride) continue;

    await ctx.db.insert("flt_garrison_routes", {
      gameId: params.gameId,
      empireId: params.empireId,
      originSystemId: route.originSystemId,
      destinationSystemId: route.destinationSystemId,
      dispatchPct: route.dispatchPct,
      enabled: true,
      managedByStrategy: true,
      strategyPurpose: route.purpose,
      strategyUpdatedTurn: params.turnNumber,
    });
  }
}

async function maintainStrategyRoutesForEmpire(
  ctx: MutationCtx,
  params: {
    gameId: Id<"sim_games">;
    turnNumber: number;
    empire: Doc<"emp_states">;
    automation: StrategyAutomation;
    systems: Doc<"gal_systems">[];
    ownedSystems: Doc<"gal_systems">[];
    adjacency: Map<string, Id<"gal_systems">[]>;
    strengthBySystem: Map<string, Map<string, number>>;
    existingRoutes: Doc<"flt_garrison_routes">[];
  },
): Promise<void> {
  const systemsById = new Map(params.systems.map((system) => [system._id, system]));
  const ownedSystems = params.ownedSystems;
  const ownedSystemIds = new Set(ownedSystems.map((system) => system._id as string));
  if (ownedSystems.length === 0) {
    await upsertStrategyRoutes(ctx, {
      gameId: params.gameId,
      empireId: params.empire._id,
      turnNumber: params.turnNumber,
      desiredRoutes: [],
      existingRoutes: params.existingRoutes,
    });
    return;
  }

  const borderSystems = ownedSystems.filter((system) =>
    (params.adjacency.get(system._id) ?? []).some((neighborId) => {
      const neighbor = systemsById.get(neighborId);
      return neighbor !== undefined && neighbor.ownerEmpireId !== params.empire._id;
    }),
  );
  const borderSystemIds = new Set(borderSystems.map((system) => system._id as string));
  const desired = new Map<string, DesiredRoute>();

  for (const origin of borderSystems) {
    const neighbors = params.adjacency.get(origin._id) ?? [];
    const neutralNeighbors = neighbors
      .map((neighborId) => systemsById.get(neighborId))
      .filter((system): system is Doc<"gal_systems"> => system?.ownerEmpireId === null);

    if (params.automation.earlyRush && neutralNeighbors.length > 0) {
      const sortedNeutral = [...neutralNeighbors].sort((a, b) => {
        if (params.automation.neutralWorldPriority === "richest") {
          return systemResourceScore(b) - systemResourceScore(a) || a._id.localeCompare(b._id);
        }
        return a._id.localeCompare(b._id);
      });
      putDesiredRoute(desired, {
        originSystemId: origin._id,
        destinationSystemId: sortedNeutral[0]._id,
        dispatchPct: Math.round(100 - params.automation.reserveShipsPct),
        purpose: "earlyRush",
      });
      continue;
    }

    if (
      params.automation.stance !== "passive" &&
      params.automation.stance !== "defensive"
    ) {
      const enemyNeighbors = neighbors
        .map((neighborId) => systemsById.get(neighborId))
        .filter(
          (system): system is Doc<"gal_systems"> =>
            system !== undefined &&
            system.ownerEmpireId !== null &&
            system.ownerEmpireId !== params.empire._id,
        )
        .sort((a, b) => a._id.localeCompare(b._id));

      for (const target of enemyNeighbors) {
        const availableAttack = strengthAtSystemForEmpire(
          params.strengthBySystem,
          origin._id,
          params.empire._id,
        );
        const enemyStrength = Math.max(
          1,
          totalForeignStrengthAtSystem(params.strengthBySystem, target._id, params.empire._id),
        );
        if (
          availableAttack >=
          enemyStrength * params.automation.attackAdvantageRequired
        ) {
          putDesiredRoute(desired, {
            originSystemId: origin._id,
            destinationSystemId: target._id,
            dispatchPct: Math.round(100 - params.automation.borderReserveShipsPct),
            purpose: "enemyAttack",
          });
          break;
        }
      }
    }
  }

  if (params.automation.moveDeepFleetsToBorder && borderSystems.length > 0) {
    for (const origin of ownedSystems) {
      if (borderSystemIds.has(origin._id)) continue;
      const firstHop = firstHopTowardNearestBorder({
        originSystemId: origin._id,
        borderSystemIds,
        ownedSystemIds,
        adjacency: params.adjacency,
      });
      if (firstHop === null) continue;
      putDesiredRoute(desired, {
        originSystemId: origin._id,
        destinationSystemId: firstHop,
        dispatchPct: Math.round(100 - params.automation.borderReserveShipsPct),
        purpose: "borderReinforce",
      });
    }
  }

  await upsertStrategyRoutes(ctx, {
    gameId: params.gameId,
    empireId: params.empire._id,
    turnNumber: params.turnNumber,
    desiredRoutes: Array.from(desired.values()).filter((route) => route.dispatchPct > 0),
    existingRoutes: params.existingRoutes,
  });
}

export async function applyNpcStrategy(
  ctx: MutationCtx,
  params: {
    gameId: Id<"sim_games">;
    turnNumber: number;
  },
): Promise<void> {
  const empires = await ctx.db
    .query("emp_states")
    .withIndex("by_gameId", (q) => q.eq("gameId", params.gameId))
    .take(64);
  const systems = await ctx.db
    .query("gal_systems")
    .withIndex("by_gameId", (q) => q.eq("gameId", params.gameId))
    .take(512);
  const links = await ctx.db
    .query("gal_links")
    .withIndex("by_gameId", (q) => q.eq("gameId", params.gameId))
    .take(1024);
  const fleets = await ctx.db
    .query("flt_fleets")
    .withIndex("by_gameId", (q) => q.eq("gameId", params.gameId))
    .take(512);
  const routes = await ctx.db
    .query("flt_garrison_routes")
    .withIndex("by_gameId", (q) => q.eq("gameId", params.gameId))
    .take(512);

  const adjacency = buildAdjacency(links);
  const strengthBySystem = fleetStrengthBySystem(fleets);
  const systemsByEmpire = new Map<string, Doc<"gal_systems">[]>();
  for (const system of systems) {
    if (system.ownerEmpireId === null) continue;
    const existing = systemsByEmpire.get(system.ownerEmpireId) ?? [];
    existing.push(system);
    systemsByEmpire.set(system.ownerEmpireId, existing);
  }
  const routesByEmpire = new Map<string, Doc<"flt_garrison_routes">[]>();
  for (const route of routes) {
    const existing = routesByEmpire.get(route.empireId) ?? [];
    existing.push(route);
    routesByEmpire.set(route.empireId, existing);
  }

  for (const empire of empires) {
    if (empire.isCollapsed || empire.strategyJson === undefined) {
      continue;
    }

    const ownedSystems = systemsByEmpire.get(empire._id) ?? [];
    const economy = parseEconomy(empire.strategyJson);
    if (economy !== null) {
      await applyEconomyStrategyToEmpire(ctx, {
        gameId: params.gameId,
        empire,
        economy,
        ownedSystems,
      });
    }

    const automation = parseAutomation(empire.strategyJson);
    if (automation !== null) {
      await maintainStrategyRoutesForEmpire(ctx, {
        gameId: params.gameId,
        turnNumber: params.turnNumber,
        empire,
        automation,
        systems,
        ownedSystems,
        adjacency,
        strengthBySystem,
        existingRoutes: routesByEmpire.get(empire._id) ?? [],
      });
    }
  }
}

export const applyNpcStrategyAndGarrisonRoutes = internalMutation({
  args: {
    gameId: v.id("sim_games"),
    turnNumber: v.number(),
  },
  handler: async (ctx, args) => {
    await applyNpcStrategy(ctx, args);
    await applyGarrisonRoutes(ctx, args);
    return null;
  },
});
