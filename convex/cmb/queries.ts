import { query, type QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { v } from "convex/values";

function resolveGameRuntimeVersion(
  runtimeVersion: "v1_empire" | "v2_game_actor" | null | undefined,
): "v1_empire" | "v2_game_actor" {
  return runtimeVersion ?? "v1_empire";
}

type BattleShipCounts = {
  attackerShipsAtStart: number | null;
  defenderShipsAtStart: number | null;
};

type ActiveBattleWithShipCounts = Doc<"cmb_battles"> & {
  runtimeVersion: "v1_empire" | "v2_game_actor";
  attackerShips: number;
  defenderShips: number;
  attackerShipsAtStart: number;
  defenderShipsAtStart: number;
  attackerMotherships: number;
  defenderMotherships: number;
  attackerActorId: Id<"sim_game_actors"> | null;
  attackerActorSlotNumber: number | null;
  attackerActorLabel: string | null;
  attackerActorDisplayName: string | null;
  attackerDisplayLabel: string;
  defenderActorId: Id<"sim_game_actors"> | null;
  defenderActorSlotNumber: number | null;
  defenderActorLabel: string | null;
  defenderActorDisplayName: string | null;
  defenderDisplayLabel: string;
  latestRound: BattleRoundReplay | null;
};

type BattleSideCounts = {
  ships: number;
  empireIds: Id<"emp_states">[];
  actorIds: Id<"sim_game_actors">[];
};

type MothershipDamageReplay = {
  side: "attacker" | "defender";
  colonyShipId: string;
  name: string;
  damageApplied: number;
  damageBefore: number;
  damageAfter: number;
  destroyed: boolean;
};

type BattleRoundReplay = {
  turnNumber: number;
  phase: "opening" | "full";
  roundNumber: number;
  attackerShipsBefore: number;
  defenderShipsBefore: number;
  attackerShipsAfter: number;
  defenderShipsAfter: number;
  attackerLosses: number;
  defenderLosses: number;
  mothershipEvents: MothershipDamageReplay[];
};

function finiteWholeNumber(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  return Math.max(0, Math.floor(value));
}

function roundPhase(value: unknown): BattleRoundReplay["phase"] | null {
  return value === "opening" || value === "full"
    ? value
    : null;
}

function sideRole(value: unknown): MothershipDamageReplay["side"] | null {
  return value === "attacker" || value === "defender" ? value : null;
}

function battleAttackerFleetIds(battle: Doc<"cmb_battles">): Id<"flt_fleets">[] {
  return battle.attackerFleetIds ?? [battle.attackerFleetId];
}

function battleDefenderFleetIds(battle: Doc<"cmb_battles">): Id<"flt_fleets">[] {
  return battle.defenderFleetIds ?? [battle.defenderFleetId];
}

function uniqueFleetIds(ids: Id<"flt_fleets">[]): Id<"flt_fleets">[] {
  return Array.from(new Set(ids));
}

function mothershipEventsFromPayload(value: unknown): MothershipDamageReplay[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
      return [];
    }
    const row = entry as Record<string, unknown>;
    const side = sideRole(row.side);
    const colonyShipId = typeof row.colonyShipId === "string" ? row.colonyShipId : null;
    const name = typeof row.name === "string" ? row.name : "Mothership";
    const damageApplied = finiteWholeNumber(row.damageApplied);
    const damageBefore = finiteWholeNumber(row.damageBefore);
    const damageAfter = finiteWholeNumber(row.damageAfter);
    if (
      side === null ||
      colonyShipId === null ||
      damageApplied === null ||
      damageBefore === null ||
      damageAfter === null
    ) {
      return [];
    }
    return [
      {
        side,
        colonyShipId,
        name,
        damageApplied,
        damageBefore,
        damageAfter,
        destroyed: row.destroyed === true,
      },
    ];
  });
}

function battleStartCountsFromPayload(
  payload: string,
  battleId: string,
): BattleShipCounts | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return null;
  }

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }

  const row = parsed as Record<string, unknown>;
  if (row.battleId !== battleId) {
    return null;
  }

  return {
    attackerShipsAtStart: finiteWholeNumber(row.attackerShips),
    defenderShipsAtStart: finiteWholeNumber(row.defenderShips),
  };
}

async function loadBattleStartCounts(
  ctx: QueryCtx,
  battle: Doc<"cmb_battles">,
): Promise<BattleShipCounts> {
  const events = await ctx.db
    .query("sim_events")
    .withIndex("by_gameId_and_turnNumber", (q) =>
      q.eq("gameId", battle.gameId).eq("turnNumber", battle.startedTurn),
    )
    .take(256);

  for (const event of events) {
    if (event.eventType !== "battle_started") {
      continue;
    }
    const counts = battleStartCountsFromPayload(event.payload, battle._id);
    if (counts !== null) {
      return counts;
    }
  }

  return { attackerShipsAtStart: null, defenderShipsAtStart: null };
}

function battleRoundReplayFromPayload(
  payload: string,
  battle: Doc<"cmb_battles">,
  turnNumber: number,
): BattleRoundReplay | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return null;
  }

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }

  const row = parsed as Record<string, unknown>;
  const payloadBattleId = typeof row.battleId === "string" ? row.battleId : null;
  const matchesBattle =
    payloadBattleId === battle._id ||
    (payloadBattleId === null &&
      row.systemId === battle.systemId &&
      row.attackerEmpireId === battle.attackerEmpireId &&
      row.defenderEmpireId === battle.defenderEmpireId);
  if (!matchesBattle) {
    return null;
  }

  const phase = roundPhase(row.phase);
  const roundNumber = finiteWholeNumber(row.roundNumber);
  const attackerShipsBefore = finiteWholeNumber(row.attackerShipsBefore);
  const defenderShipsBefore = finiteWholeNumber(row.defenderShipsBefore);
  const attackerShipsAfter = finiteWholeNumber(row.attackerShipsAfter);
  const defenderShipsAfter = finiteWholeNumber(row.defenderShipsAfter);
  const attackerLosses = finiteWholeNumber(row.attackerLosses);
  const defenderLosses = finiteWholeNumber(row.defenderLosses);

  if (
    phase === null ||
    roundNumber === null ||
    attackerShipsBefore === null ||
    defenderShipsBefore === null ||
    attackerShipsAfter === null ||
    defenderShipsAfter === null ||
    attackerLosses === null ||
    defenderLosses === null
  ) {
    return null;
  }

  return {
    turnNumber,
    phase,
    roundNumber,
    attackerShipsBefore,
    defenderShipsBefore,
    attackerShipsAfter,
    defenderShipsAfter,
    attackerLosses,
    defenderLosses,
    mothershipEvents: mothershipEventsFromPayload(row.mothershipEvents),
  };
}

async function countIdleMotherships(
  ctx: QueryCtx,
  battle: Doc<"cmb_battles">,
  empireId: Id<"emp_states">,
): Promise<number> {
  const ships = await ctx.db
    .query("col_colony_ships")
    .withIndex("by_gameId_and_originSystemId_and_status", (q) =>
      q
        .eq("gameId", battle.gameId)
        .eq("originSystemId", battle.systemId)
        .eq("status", "idle"),
    )
    .take(32);
  return ships.filter((ship) => ship.empireId === empireId).length;
}

async function countIdleMothershipsForActors(
  ctx: QueryCtx,
  battle: Doc<"cmb_battles">,
  actorIds: Id<"sim_game_actors">[],
): Promise<number> {
  const ships = await ctx.db
    .query("col_colony_ships")
    .withIndex("by_gameId_and_originSystemId_and_status", (q) =>
      q
        .eq("gameId", battle.gameId)
        .eq("originSystemId", battle.systemId)
        .eq("status", "idle"),
    )
    .take(32);
  const actorIdSet = new Set(actorIds);
  return ships.filter(
    (ship) => ship.gameActorId !== undefined && actorIdSet.has(ship.gameActorId),
  ).length;
}

async function countIdleMothershipsForEmpires(
  ctx: QueryCtx,
  battle: Doc<"cmb_battles">,
  empireIds: Id<"emp_states">[],
): Promise<number> {
  let total = 0;
  for (const empireId of Array.from(new Set(empireIds))) {
    total += await countIdleMotherships(ctx, battle, empireId);
  }
  return total;
}

async function sumFleetStrengths(
  ctx: QueryCtx,
  fleetIds: Id<"flt_fleets">[],
): Promise<BattleSideCounts> {
  let ships = 0;
  const empireIds: Id<"emp_states">[] = [];
  const actorIds: Id<"sim_game_actors">[] = [];
  for (const fleetId of uniqueFleetIds(fleetIds)) {
    const fleet = await ctx.db.get("flt_fleets", fleetId);
    if (fleet === null) continue;
    ships += Math.max(0, Math.floor(fleet.strength));
    empireIds.push(fleet.empireId);
    if (fleet.gameActorId !== undefined) {
      actorIds.push(fleet.gameActorId);
    }
  }
  return { ships, empireIds, actorIds };
}

function formatBattleSideLabel(params: {
  runtimeVersion: "v1_empire" | "v2_game_actor";
  empire: Doc<"emp_states"> | null;
  actor: Doc<"sim_game_actors"> | null;
}): string {
  if (
    params.runtimeVersion === "v2_game_actor" &&
    params.actor !== null
  ) {
    const actorName =
      params.actor.displayNameSnapshot ??
      params.actor.factionLabelSnapshot ??
      params.empire?.name ??
      "";
    return `Actor ${params.actor.slotNumber}${actorName.length > 0 ? ` · ${actorName}` : ""}`;
  }
  return params.empire?.name ?? "Empire";
}

async function loadLatestBattleRoundReplay(
  ctx: QueryCtx,
  battle: Doc<"cmb_battles">,
): Promise<BattleRoundReplay | null> {
  const events = await ctx.db
    .query("sim_events")
    .withIndex("by_gameId_and_turnNumber", (q) =>
      q.eq("gameId", battle.gameId).eq("turnNumber", battle.updatedTurn),
    )
    .take(256);

  const rounds: BattleRoundReplay[] = [];
  for (const event of events) {
    if (event.eventType !== "battle_round_resolved") {
      continue;
    }
    const round = battleRoundReplayFromPayload(event.payload, battle, event.turnNumber);
    if (round !== null) {
      rounds.push(round);
    }
  }

  return rounds.sort((a, b) => b.roundNumber - a.roundNumber)[0] ?? null;
}

export const listActiveBattles = query({
  args: { gameId: v.id("sim_games"), limit: v.number() },
  handler: async (ctx, args) => {
    const game = await ctx.db.get("sim_games", args.gameId);
    const runtimeVersion = resolveGameRuntimeVersion(game?.runtimeVersion);
    const battles = await ctx.db
      .query("cmb_battles")
      .withIndex("by_gameId_and_status", (q) =>
        q.eq("gameId", args.gameId).eq("status", "active"),
      )
      .take(args.limit);

    const [empires, actors] = await Promise.all([
      ctx.db
        .query("emp_states")
        .withIndex("by_gameId", (q) => q.eq("gameId", args.gameId))
        .collect(),
      runtimeVersion === "v2_game_actor"
        ? ctx.db
            .query("sim_game_actors")
            .withIndex("by_gameId", (q) => q.eq("gameId", args.gameId))
            .collect()
        : Promise.resolve([] as Doc<"sim_game_actors">[]),
    ]);
    const empireById = new Map(empires.map((empire) => [empire._id, empire] as const));
    const actorById = new Map(actors.map((actor) => [actor._id, actor] as const));
    const actorByLegacyEmpireId = new Map(
      actors
        .filter((actor) => actor.legacyEmpireId !== null)
        .map((actor) => [actor.legacyEmpireId!, actor] as const),
    );

    const result: ActiveBattleWithShipCounts[] = [];
    for (const battle of battles) {
      const startCounts = await loadBattleStartCounts(ctx, battle);
      const latestRound = await loadLatestBattleRoundReplay(ctx, battle);
      const attackerCounts = await sumFleetStrengths(
        ctx,
        battleAttackerFleetIds(battle),
      );
      const defenderCounts = await sumFleetStrengths(
        ctx,
        battleDefenderFleetIds(battle),
      );
      const attackerShips = attackerCounts.ships;
      const defenderShips = defenderCounts.ships;
      const attackerActor =
        (attackerCounts.actorIds[0] !== undefined
          ? actorById.get(attackerCounts.actorIds[0])
          : null) ?? actorByLegacyEmpireId.get(battle.attackerEmpireId) ?? null;
      const defenderActor =
        (defenderCounts.actorIds[0] !== undefined
          ? actorById.get(defenderCounts.actorIds[0])
          : null) ?? actorByLegacyEmpireId.get(battle.defenderEmpireId) ?? null;
      const attackerEmpire = empireById.get(battle.attackerEmpireId) ?? null;
      const defenderEmpire = empireById.get(battle.defenderEmpireId) ?? null;

      result.push({
        ...battle,
        runtimeVersion,
        attackerShips,
        defenderShips,
        attackerShipsAtStart: startCounts.attackerShipsAtStart ?? attackerShips,
        defenderShipsAtStart: startCounts.defenderShipsAtStart ?? defenderShips,
        attackerMotherships:
          runtimeVersion === "v2_game_actor" && attackerCounts.actorIds.length > 0
            ? await countIdleMothershipsForActors(ctx, battle, attackerCounts.actorIds)
            : await countIdleMothershipsForEmpires(ctx, battle, attackerCounts.empireIds),
        defenderMotherships:
          runtimeVersion === "v2_game_actor" && defenderCounts.actorIds.length > 0
            ? await countIdleMothershipsForActors(ctx, battle, defenderCounts.actorIds)
            : await countIdleMothershipsForEmpires(ctx, battle, defenderCounts.empireIds),
        attackerActorId: attackerActor?._id ?? null,
        attackerActorSlotNumber: attackerActor?.slotNumber ?? null,
        attackerActorLabel: attackerActor?.factionLabelSnapshot ?? null,
        attackerActorDisplayName: attackerActor?.displayNameSnapshot ?? null,
        attackerDisplayLabel: formatBattleSideLabel({
          runtimeVersion,
          empire: attackerEmpire,
          actor: attackerActor,
        }),
        defenderActorId: defenderActor?._id ?? null,
        defenderActorSlotNumber: defenderActor?.slotNumber ?? null,
        defenderActorLabel: defenderActor?.factionLabelSnapshot ?? null,
        defenderActorDisplayName: defenderActor?.displayNameSnapshot ?? null,
        defenderDisplayLabel: formatBattleSideLabel({
          runtimeVersion,
          empire: defenderEmpire,
          actor: defenderActor,
        }),
        latestRound,
      });
    }

    return result;
  },
});

const MAX_COMBAT_DAMAGE_TURNS = 80;

type CombatDamageTotals = {
  stockFood: number;
  stockWeapons: number;
  stockResearch: number;
  population: number;
};

type CombatShipLossTotals = {
  attackerShipsDestroyed: number;
  defenderShipsDestroyed: number;
};

function emptyCombatDamageTotals(): CombatDamageTotals {
  return {
    stockFood: 0,
    stockWeapons: 0,
    stockResearch: 0,
    population: 0,
  };
}

function collateralDamageFromEventPayload(
  payload: string,
  systemId: string,
): Partial<CombatDamageTotals> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return {};
  }

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {};
  }

  const row = parsed as Record<string, unknown>;
  if (row.systemId !== systemId) {
    return {};
  }

  const amount = row.amount;
  const value = typeof amount === "number" && Number.isFinite(amount)
    ? Math.max(0, Math.floor(amount))
    : 0;
  if (
    row.category === "stockFood" ||
    row.category === "stockWeapons" ||
    row.category === "stockResearch" ||
    row.category === "population"
  ) {
    return { [row.category]: value };
  }
  return {};
}

async function cumulativeCombatEffectsForBattle(
  ctx: QueryCtx,
  battle: Doc<"cmb_battles">,
): Promise<CombatDamageTotals & CombatShipLossTotals> {
  const lastTurn = Math.min(
    battle.updatedTurn,
    battle.startedTurn + MAX_COMBAT_DAMAGE_TURNS - 1,
  );
  const damage = emptyCombatDamageTotals();
  const losses: CombatShipLossTotals = {
    attackerShipsDestroyed: 0,
    defenderShipsDestroyed: 0,
  };

  for (let turn = battle.startedTurn; turn <= lastTurn; turn += 1) {
    const events = await ctx.db
      .query("sim_events")
      .withIndex("by_gameId_and_turnNumber", (q) =>
        q.eq("gameId", battle.gameId).eq("turnNumber", turn),
      )
      .take(256);

    for (const event of events) {
      if (event.targetId !== battle.systemId) {
        continue;
      }

      if (event.eventType === "collateral_damage_applied") {
        const eventDamage = collateralDamageFromEventPayload(event.payload, battle.systemId);
        damage.stockFood += eventDamage.stockFood ?? 0;
        damage.stockWeapons += eventDamage.stockWeapons ?? 0;
        damage.stockResearch += eventDamage.stockResearch ?? 0;
        damage.population += eventDamage.population ?? 0;
      } else if (event.eventType === "battle_round_resolved") {
        const round = battleRoundReplayFromPayload(event.payload, battle, event.turnNumber);
        if (round !== null) {
          losses.attackerShipsDestroyed += round.attackerLosses;
          losses.defenderShipsDestroyed += round.defenderLosses;
        }
      }
    }
  }

  return { ...damage, ...losses };
}

export const getMostRecentCombatForSystem = query({
  args: {
    gameId: v.id("sim_games"),
    systemId: v.id("gal_systems"),
  },
  handler: async (ctx, args) => {
    const activeBattles = await ctx.db
      .query("cmb_battles")
      .withIndex("by_gameId_and_systemId_and_status", (q) =>
        q.eq("gameId", args.gameId).eq("systemId", args.systemId).eq("status", "active"),
      )
      .order("desc")
      .take(4);

    const resolvedBattles = await ctx.db
      .query("cmb_battles")
      .withIndex("by_gameId_and_systemId_and_status", (q) =>
        q.eq("gameId", args.gameId).eq("systemId", args.systemId).eq("status", "resolved"),
      )
      .order("desc")
      .take(4);

    const battle = [...activeBattles, ...resolvedBattles].sort(
      (a, b) => b.updatedTurn - a.updatedTurn || b.startedTurn - a.startedTurn,
    )[0];

    if (battle === undefined) {
      return null;
    }

    const effects = await cumulativeCombatEffectsForBattle(ctx, battle);

    return {
      battleId: battle._id,
      status: battle.status,
      startedTurn: battle.startedTurn,
      endedTurn: battle.status === "resolved" ? battle.updatedTurn : null,
      foodStockpileDamage: effects.stockFood,
      weaponsStockpileDamage: effects.stockWeapons,
      researchStockpileDamage: effects.stockResearch,
      populationDamage: effects.population,
      attackerShipsDestroyed: effects.attackerShipsDestroyed,
      defenderShipsDestroyed: effects.defenderShipsDestroyed,
    };
  },
});
