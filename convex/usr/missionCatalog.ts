import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import {
  isPublishedContentStatus,
  resolvePublisherContentReviewStatus,
  resolvePublisherContentSource,
  resolvePublisherContentStatus,
  type PublisherContentReviewStatus,
  type PublisherContentSource,
  type PublisherContentStatus,
} from "./publisherAccess";

export type AccessTier = "free" | "pro";
export type MissionMode = "conquest_core" | "conquest_plus" | "trader_economy";

type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
type JsonObject = { [key: string]: JsonValue };

export type MapTier = "small" | "medium" | "large";

export type MissionSlotTrigger =
  | { kind: "turn"; turn: number }
  | { kind: "attacked" }
  | {
      kind: "intruder_detection";
      routeSteps: number;
      requireNewEmpire: boolean;
    };

export type MissionSlotSensors = {
  fightAttraction: number | null;
  intruderDetection: {
    routeSteps: number;
    requireNewEmpire: boolean;
  } | null;
};

export type MissionSlotAutomation = {
  strategyLibraryKey: string | null;
  activationTrigger: MissionSlotTrigger | null;
};

export type MissionSlotPresentation = {
  factionLabelOverride: string | null;
  displayNameOverride: string | null;
};

export type MissionSlotResources = {
  treasuryDelta: number;
  homeworldPopulationDelta: number;
  homeworldStockFoodDelta: number;
  homeworldStockWeaponsDelta: number;
  homeworldStockResearchDelta: number;
  homeworldLocalTreasuryDelta: number;
};

export type MissionSlotOccupant =
  | { kind: "human" }
  | {
      kind: "npc";
      npcPlayerKey: string;
    };

/**
 * A **slot** is an empire position authored into a mission scenario. Each slot carries:
 * - `slotKey`: the runtime empire identifier (e.g. `"aurora"` for the player's default empire).
 * - `occupant`: who fills the slot at runtime:
 *     - `{ kind: "human" }` — the human player joins this empire; identity, strategy, and color
 *       are drawn from the player's profile and empire preferences.
 *     - `{ kind: "npc", npcPlayerKey }` — an NPC persona from the catalog fills the slot;
 *       identity, strategy, and color are drawn from the NPC catalog entry.
 *
 * A mission scenario must contain exactly one human-occupant slot. That slot is the player's seat.
 */
export type MissionSlot = {
  slotKey: string;
  occupant: MissionSlotOccupant;
  automation: MissionSlotAutomation;
  presentation: MissionSlotPresentation;
  resources: MissionSlotResources;
  sensors: MissionSlotSensors;
  startsHidden: boolean;
  revealTrigger: MissionSlotTrigger | null;
};

export type MissionScenario = {
  schemaVersion: 2;
  slots: MissionSlot[];
};

export type MissionCatalogRecord = Doc<"sim_missions">;

export type MissionCatalogRow = {
  key: string;
  name: string;
  description: string;
  mapKey: string;
  ownerUserId: Id<"users"> | null;
  source: PublisherContentSource;
  reviewStatus: PublisherContentReviewStatus;
  status: PublisherContentStatus;
  mode: MissionMode;
  requiredTier: AccessTier;
  mapTier: MapTier;
  level: number;
  requiredWins: number;
  prerequisiteMissionKeys: string[];
  published: boolean;
  sortOrder: number;
  retentionClass: MissionCatalogRecord["retentionClass"];
  scenarioJson: string;
  scenario: MissionScenario;
  preview: {
    playerSlotKey: string;
    slotCount: number;
    npcControlledCount: number;
    delayedAutomationCount: number;
    handicapCount: number;
    fightAttractionCount: number;
    intruderDetectionCount: number;
  };
  createdAt: number;
  updatedAt: number;
};

export type MissionCatalogSeedRow = Omit<
  MissionCatalogRow,
  "mapTier" | "scenario" | "preview" | "reviewStatus"
>;

export function missionIsAvailableForTier(
  mission: Pick<MissionCatalogRow, "requiredTier">,
  tier: AccessTier,
): boolean {
  return tier === "pro" || mission.requiredTier === "free";
}

function resolveMissionMode(
  mode: MissionCatalogRecord["mode"] | MissionMode | undefined,
): MissionMode {
  return mode ?? "conquest_core";
}

function resolveRequiredTier(
  tier: MissionCatalogRecord["requiredTier"] | AccessTier | undefined,
): AccessTier {
  return tier ?? "free";
}

type DbCtx = { db: QueryCtx["db"] | MutationCtx["db"] };

function asJsonObject(value: unknown, label: string): JsonObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be a JSON object.`);
  }
  return value as JsonObject;
}

function parseJsonObjectString(text: string, label: string): JsonObject {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    throw new Error(`${label} cannot be empty.`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new Error(`${label} must be valid JSON.`);
  }

  return asJsonObject(parsed, label);
}

function asString(value: JsonValue | undefined, label: string): string {
  if (typeof value !== "string") {
    throw new Error(`${label} must be a string.`);
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new Error(`${label} cannot be empty.`);
  }
  return trimmed;
}

function asNullableString(value: JsonValue | undefined, label: string): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  return asString(value, label);
}

function asFiniteNumber(value: JsonValue | undefined, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${label} must be a number.`);
  }
  return value;
}

function asNullableInteger(value: JsonValue | undefined, label: string): number | null {
  if (value === undefined || value === null) {
    return null;
  }
  return Math.max(1, Math.floor(asFiniteNumber(value, label)));
}

function asNumberWithDefault(value: JsonValue | undefined, fallback: number, label: string): number {
  if (value === undefined) {
    return fallback;
  }
  return asFiniteNumber(value, label);
}

function asMissionSlotOccupant(
  value: JsonValue | undefined,
  label: string,
): MissionSlotOccupant {
  const occupant = asJsonObject(value, label);
  const kind = asString(occupant.kind, `${label}.kind`);
  if (kind === "human") {
    return { kind };
  }
  if (kind === "npc") {
    return {
      kind,
      npcPlayerKey: asString(occupant.npcPlayerKey, `${label}.npcPlayerKey`),
    };
  }
  throw new Error(`${label}.kind must be 'human' or 'npc'.`);
}

function asMissionSlotTrigger(
  value: JsonValue | undefined,
  label: string,
): MissionSlotTrigger | null {
  if (value === undefined || value === null) {
    return null;
  }
  const trigger = asJsonObject(value, label);
  const kind = asString(trigger.kind, `${label}.kind`);
  if (kind === "attacked") {
    return { kind };
  }
  if (kind === "turn") {
    return {
      kind,
      turn: asNullableInteger(trigger.turn, `${label}.turn`) ?? 1,
    };
  }
  if (kind === "intruder_detection") {
    const requireNewEmpire =
      trigger.requireNewEmpire === undefined ? true : Boolean(trigger.requireNewEmpire);
    return {
      kind,
      routeSteps: asNullableInteger(trigger.routeSteps, `${label}.routeSteps`) ?? 1,
      requireNewEmpire,
    };
  }
  throw new Error(`${label}.kind must be 'turn', 'attacked', or 'intruder_detection'.`);
}

function mapMissionSlotResources(config: JsonObject, label: string): MissionSlotResources {
  return {
    treasuryDelta: asNumberWithDefault(config.treasuryDelta, 0, `${label}.treasuryDelta`),
    homeworldPopulationDelta: asNumberWithDefault(
      config.homeworldPopulationDelta,
      0,
      `${label}.homeworldPopulationDelta`,
    ),
    homeworldStockFoodDelta: asNumberWithDefault(
      config.homeworldStockFoodDelta,
      0,
      `${label}.homeworldStockFoodDelta`,
    ),
    homeworldStockWeaponsDelta: asNumberWithDefault(
      config.homeworldStockWeaponsDelta,
      0,
      `${label}.homeworldStockWeaponsDelta`,
    ),
    homeworldStockResearchDelta: asNumberWithDefault(
      config.homeworldStockResearchDelta,
      0,
      `${label}.homeworldStockResearchDelta`,
    ),
    homeworldLocalTreasuryDelta: asNumberWithDefault(
      config.homeworldLocalTreasuryDelta,
      0,
      `${label}.homeworldLocalTreasuryDelta`,
    ),
  };
}

function mapMissionSlot(value: JsonValue, index: number): MissionSlot {
  const slot = asJsonObject(value, `Mission scenario slots[${index}]`);
  const slotKey = asString(slot.slotKey, `slots[${index}].slotKey`);
  const occupant = asMissionSlotOccupant(slot.occupant, `slots[${index}].occupant`);
  const automation =
    slot.automation === undefined
      ? null
      : asJsonObject(slot.automation, `slots[${index}].automation`);
  const presentation =
    slot.presentation === undefined
      ? null
      : asJsonObject(slot.presentation, `slots[${index}].presentation`);
  const sensors =
    slot.sensors === undefined
      ? null
      : asJsonObject(slot.sensors, `slots[${index}].sensors`);
  const intruderDetection =
    sensors?.intruderDetection === undefined || sensors?.intruderDetection === null
      ? null
      : asJsonObject(
          sensors.intruderDetection,
          `slots[${index}].sensors.intruderDetection`,
        );

  return {
    slotKey,
    occupant,
    automation: {
      strategyLibraryKey: asNullableString(
        automation?.strategyLibraryKey,
        `slots[${index}].automation.strategyLibraryKey`,
      ),
      activationTrigger: asMissionSlotTrigger(
        automation?.activationTrigger,
        `slots[${index}].automation.activationTrigger`,
      ),
    },
    presentation: {
      factionLabelOverride: asNullableString(
        presentation?.factionLabelOverride,
        `slots[${index}].presentation.factionLabelOverride`,
      ),
      displayNameOverride: asNullableString(
        presentation?.displayNameOverride,
        `slots[${index}].presentation.displayNameOverride`,
      ),
    },
    resources: mapMissionSlotResources(slot, `slots[${index}]`),
    sensors: {
      fightAttraction:
        sensors?.fightAttraction === undefined || sensors?.fightAttraction === null
          ? null
          : asFiniteNumber(
              sensors.fightAttraction,
              `slots[${index}].sensors.fightAttraction`,
            ),
      intruderDetection:
        intruderDetection === null
          ? null
          : {
              routeSteps:
                asNullableInteger(
                  intruderDetection.routeSteps,
                  `slots[${index}].sensors.intruderDetection.routeSteps`,
                ) ?? 1,
              requireNewEmpire:
                intruderDetection.requireNewEmpire === undefined
                  ? true
                  : Boolean(intruderDetection.requireNewEmpire),
            },
    },
    startsHidden: slot.startsHidden === true,
    revealTrigger: asMissionSlotTrigger(
      slot.revealTrigger,
      `slots[${index}].revealTrigger`,
    ),
  };
}

function missionSlotNpcPlayerKey(slot: MissionSlot): string | null {
  return slot.occupant.kind === "npc" ? slot.occupant.npcPlayerKey : null;
}

function missionSlotUsesSeededNpcSlot(slot: MissionSlot): boolean {
  return slot.occupant.kind === "npc";
}

function missionSlotRuntimeEmpireKey(slot: MissionSlot): string {
  if (missionSlotUsesSeededNpcSlot(slot)) {
    const npcPlayerKey = missionSlotNpcPlayerKey(slot);
    if (npcPlayerKey !== null) {
      return `npc-${npcPlayerKey}`;
    }
  }
  return slot.slotKey;
}

export function parseMissionScenarioJson(scenarioJson: string): MissionScenario {
  const scenario = parseJsonObjectString(scenarioJson, "Mission scenario JSON");

  const schemaVersion = scenario.schemaVersion === undefined ? 2 : asFiniteNumber(scenario.schemaVersion, "Mission scenario schemaVersion");
  if (schemaVersion !== 2) {
    throw new Error("Mission scenario schemaVersion must be 2.");
  }
  if (!Array.isArray(scenario.slots)) {
    throw new Error("Mission scenario slots must be an array.");
  }

  const slots = scenario.slots.map((entry, index) => mapMissionSlot(entry, index));
  const humanSlots = slots.filter((slot) => slot.occupant.kind === "human");
  if (humanSlots.length !== 1) {
    throw new Error("Mission scenario must contain exactly one human occupant slot.");
  }

  return {
    schemaVersion,
    slots,
  };
}

export function canonicalizeMissionScenarioJson(scenarioJson: string): string {
  return JSON.stringify(parseMissionScenarioJson(scenarioJson), null, 2);
}

export function mapTierFromMapKey(mapKey: string): MapTier {
  if (mapKey === "v1-medium") {
    return "medium";
  }
  if (mapKey === "v1-spiral" || mapKey === "v1-large") {
    return "large";
  }
  return "small";
}

export function summarizeMissionScenario(scenario: MissionScenario) {
  const delayedAutomationCount = scenario.slots.filter(
    (slot) => slot.automation.activationTrigger !== null,
  ).length;
  const handicapCount = scenario.slots.filter(
    (slot) =>
      slot.resources.treasuryDelta !== 0 ||
      slot.resources.homeworldPopulationDelta !== 0 ||
      slot.resources.homeworldStockFoodDelta !== 0 ||
      slot.resources.homeworldStockWeaponsDelta !== 0 ||
      slot.resources.homeworldStockResearchDelta !== 0 ||
      slot.resources.homeworldLocalTreasuryDelta !== 0,
  ).length;
  const npcControlledCount = scenario.slots.filter(
    (slot) => slot.occupant.kind === "npc",
  ).length;
  const playerSlot = scenario.slots.find((slot) => slot.occupant.kind === "human");
  if (playerSlot === undefined) {
    throw new Error("Mission scenario must contain exactly one human occupant slot.");
  }
  const fightAttractionCount = scenario.slots.filter(
    (slot) => slot.sensors.fightAttraction !== null,
  ).length;
  const intruderDetectionCount = scenario.slots.filter(
    (slot) =>
      slot.sensors.intruderDetection !== null ||
      slot.revealTrigger?.kind === "intruder_detection" ||
      slot.automation.activationTrigger?.kind === "intruder_detection",
  ).length;

  return {
    playerSlotKey: playerSlot.slotKey,
    slotCount: scenario.slots.length,
    npcControlledCount,
    delayedAutomationCount,
    handicapCount,
    fightAttractionCount,
    intruderDetectionCount,
  };
}

export function getMissionPlayerSlotKey(scenario: MissionScenario): string {
  const playerSlot = scenario.slots.find((slot) => slot.occupant.kind === "human");
  if (playerSlot === undefined) {
    throw new Error("Mission scenario must contain exactly one human occupant slot.");
  }
  return playerSlot.slotKey;
}

export function listMissionSeededNpcPersonaKeys(scenario: MissionScenario): string[] {
  return scenario.slots
    .filter(missionSlotUsesSeededNpcSlot)
    .map((slot) => missionSlotNpcPlayerKey(slot))
    .filter((value): value is string => value !== null);
}

export function listMissionAutomatedActorKeys(scenario: MissionScenario): string[] {
  return scenario.slots
    .filter((slot) => slot.occupant.kind === "npc")
    .map((slot) => missionSlotRuntimeEmpireKey(slot));
}

export function findMissionSlot(scenario: MissionScenario, slotKey: string): MissionSlot | null {
  return scenario.slots.find((slot) => slot.slotKey === slotKey) ?? null;
}

export function toMissionCatalogRow(record: MissionCatalogRecord): MissionCatalogRow {
  const scenario = parseMissionScenarioJson(record.scenarioJson);
  const status = resolvePublisherContentStatus({
    status: record.status,
    published: record.published,
    defaultDraft: false,
  });
  return {
    key: record.key,
    name: record.name,
    description: record.description,
    mapKey: record.mapKey,
    ownerUserId: record.ownerUserId ?? null,
    source: resolvePublisherContentSource(record.source),
    reviewStatus: resolvePublisherContentReviewStatus({
      source: record.source,
      reviewStatus: record.reviewStatus,
    }),
    status,
    mode: resolveMissionMode(record.mode),
    requiredTier: resolveRequiredTier(record.requiredTier),
    mapTier: mapTierFromMapKey(record.mapKey),
    level: record.level,
    requiredWins: record.requiredWins,
    prerequisiteMissionKeys: record.prerequisiteMissionKeys,
    published: isPublishedContentStatus(status),
    sortOrder: record.sortOrder,
    retentionClass: record.retentionClass,
    scenarioJson: record.scenarioJson,
    scenario,
    preview: summarizeMissionScenario(scenario),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

function tryToMissionCatalogRow(record: MissionCatalogRecord): MissionCatalogRow | null {
  try {
    return toMissionCatalogRow(record);
  } catch {
    return null;
  }
}

const BUILT_IN_MISSION_SOURCE: Array<{
  key: string;
  name: string;
  description: string;
  mapKey: string;
  mode: MissionMode;
  requiredTier: AccessTier;
  level: number;
  requiredWins: number;
  prerequisiteMissionKeys: string[];
  published: boolean;
  sortOrder: number;
  retentionClass: MissionCatalogRecord["retentionClass"];
  scenario: MissionScenario;
}> = [
  {
    key: "starter-small-1",
    name: "Mission 1",
    description: "Command Aurora in a first duel against Iron while the enemy automation waits until turn three.",
    mapKey: "v1-twenty",
    mode: "conquest_core",
    requiredTier: "free",
    level: 1,
    requiredWins: 1,
    prerequisiteMissionKeys: [],
    published: true,
    sortOrder: 1,
    retentionClass: "official",
    scenario: {
      schemaVersion: 2,
      slots: [
        {
          slotKey: "aurora",
          occupant: { kind: "human" },
          automation: { strategyLibraryKey: null, activationTrigger: null },
          presentation: { factionLabelOverride: null, displayNameOverride: null },
          resources: {
            treasuryDelta: 0,
            homeworldPopulationDelta: 0,
            homeworldStockFoodDelta: 0,
            homeworldStockWeaponsDelta: 0,
            homeworldStockResearchDelta: 0,
            homeworldLocalTreasuryDelta: 0,
          },
          sensors: { fightAttraction: null, intruderDetection: null },
          startsHidden: false,
          revealTrigger: null,
        },
        {
          slotKey: "iron",
          occupant: { kind: "npc", npcPlayerKey: "dax-helion" },
          automation: {
            strategyLibraryKey: null,
            activationTrigger: { kind: "turn", turn: 3 },
          },
          presentation: { factionLabelOverride: null, displayNameOverride: null },
          resources: {
            treasuryDelta: 0,
            homeworldPopulationDelta: 0,
            homeworldStockFoodDelta: 0,
            homeworldStockWeaponsDelta: 0,
            homeworldStockResearchDelta: 0,
            homeworldLocalTreasuryDelta: 0,
          },
          sensors: { fightAttraction: null, intruderDetection: null },
          startsHidden: false,
          revealTrigger: null,
        },
      ],
    },
  },
  {
    key: "starter-small-2",
    name: "Mission 2",
    description: "Another small-map engagement where Iron is fully active from the opening turn.",
    mapKey: "v1-twenty",
    mode: "conquest_core",
    requiredTier: "free",
    level: 2,
    requiredWins: 1,
    prerequisiteMissionKeys: ["starter-small-1"],
    published: true,
    sortOrder: 2,
    retentionClass: "official",
    scenario: {
      schemaVersion: 2,
      slots: [
        {
          slotKey: "aurora",
          occupant: { kind: "human" },
          automation: { strategyLibraryKey: null, activationTrigger: null },
          presentation: { factionLabelOverride: null, displayNameOverride: null },
          resources: {
            treasuryDelta: 0,
            homeworldPopulationDelta: 0,
            homeworldStockFoodDelta: 0,
            homeworldStockWeaponsDelta: 0,
            homeworldStockResearchDelta: 0,
            homeworldLocalTreasuryDelta: 0,
          },
          sensors: { fightAttraction: null, intruderDetection: null },
          startsHidden: false,
          revealTrigger: null,
        },
        {
          slotKey: "iron",
          occupant: { kind: "npc", npcPlayerKey: "dax-helion" },
          automation: { strategyLibraryKey: null, activationTrigger: null },
          presentation: { factionLabelOverride: null, displayNameOverride: null },
          resources: {
            treasuryDelta: 0,
            homeworldPopulationDelta: 0,
            homeworldStockFoodDelta: 0,
            homeworldStockWeaponsDelta: 0,
            homeworldStockResearchDelta: 0,
            homeworldLocalTreasuryDelta: 0,
          },
          sensors: { fightAttraction: null, intruderDetection: null },
          startsHidden: false,
          revealTrigger: null,
        },
      ],
    },
  },
  {
    key: "starter-medium-1",
    name: "Mission 3",
    description: "Move to a medium map and face both Iron and Maia Solenne with a modest handicap on the extra enemy empire.",
    mapKey: "v1-medium",
    mode: "conquest_core",
    requiredTier: "free",
    level: 3,
    requiredWins: 1,
    prerequisiteMissionKeys: ["starter-small-2"],
    published: true,
    sortOrder: 3,
    retentionClass: "official",
    scenario: {
      schemaVersion: 2,
      slots: [
        {
          slotKey: "aurora",
          occupant: { kind: "human" },
          automation: { strategyLibraryKey: null, activationTrigger: null },
          presentation: { factionLabelOverride: null, displayNameOverride: null },
          resources: {
            treasuryDelta: 0,
            homeworldPopulationDelta: 0,
            homeworldStockFoodDelta: 0,
            homeworldStockWeaponsDelta: 0,
            homeworldStockResearchDelta: 0,
            homeworldLocalTreasuryDelta: 0,
          },
          sensors: { fightAttraction: null, intruderDetection: null },
          startsHidden: false,
          revealTrigger: null,
        },
        {
          slotKey: "iron",
          occupant: { kind: "npc", npcPlayerKey: "dax-helion" },
          automation: { strategyLibraryKey: null, activationTrigger: null },
          presentation: { factionLabelOverride: null, displayNameOverride: null },
          resources: {
            treasuryDelta: 0,
            homeworldPopulationDelta: 0,
            homeworldStockFoodDelta: 0,
            homeworldStockWeaponsDelta: 0,
            homeworldStockResearchDelta: 0,
            homeworldLocalTreasuryDelta: 0,
          },
          sensors: { fightAttraction: null, intruderDetection: null },
          startsHidden: false,
          revealTrigger: null,
        },
        {
          slotKey: "maia-rival",
          occupant: { kind: "npc", npcPlayerKey: "maia-solenne" },
          automation: {
            strategyLibraryKey: null,
            activationTrigger: { kind: "turn", turn: 2 },
          },
          presentation: { factionLabelOverride: null, displayNameOverride: null },
          resources: {
            treasuryDelta: -150,
            homeworldPopulationDelta: -5000000,
            homeworldStockFoodDelta: -400,
            homeworldStockWeaponsDelta: -20,
            homeworldStockResearchDelta: -10,
            homeworldLocalTreasuryDelta: -100,
          },
          sensors: { fightAttraction: null, intruderDetection: null },
          startsHidden: false,
          revealTrigger: null,
        },
      ],
    },
  },
];

export const BUILT_IN_MISSION_SEED_ROWS: MissionCatalogSeedRow[] = BUILT_IN_MISSION_SOURCE.map(
  (mission) => ({
    key: mission.key,
    name: mission.name,
    description: mission.description,
    mapKey: mission.mapKey,
    ownerUserId: null,
    source: "official",
    status: mission.published ? "published" : "draft",
    mode: mission.mode,
    requiredTier: mission.requiredTier,
    level: mission.level,
    requiredWins: mission.requiredWins,
    prerequisiteMissionKeys: mission.prerequisiteMissionKeys,
    published: mission.published,
    sortOrder: mission.sortOrder,
    retentionClass: mission.retentionClass,
    scenarioJson: JSON.stringify(mission.scenario, null, 2),
    createdAt: 0,
    updatedAt: 0,
  }),
);

const BUILT_IN_MISSION_BY_KEY = new Map(
  BUILT_IN_MISSION_SEED_ROWS.map((mission) => [mission.key, mission]),
);

export function getBuiltInMissionByKey(key: string): MissionCatalogRow | null {
  const record = BUILT_IN_MISSION_BY_KEY.get(key);
  if (record === undefined) {
    return null;
  }
  const scenario = parseMissionScenarioJson(record.scenarioJson);
  return {
    ...record,
    ownerUserId: record.ownerUserId,
    source: record.source,
    reviewStatus: resolvePublisherContentReviewStatus({
      source: record.source,
      reviewStatus: undefined,
    }),
    status: record.status,
    mode: resolveMissionMode(record.mode),
    requiredTier: resolveRequiredTier(record.requiredTier),
    mapTier: mapTierFromMapKey(record.mapKey),
    scenario,
    preview: summarizeMissionScenario(scenario),
  };
}

export async function getMissionByKey(ctx: DbCtx, key: string): Promise<MissionCatalogRow | null> {
  const existing = await ctx.db
    .query("sim_missions")
    .withIndex("by_key", (q) => q.eq("key", key))
    .unique();
  if (existing !== null) {
    return toMissionCatalogRow(existing);
  }
  return getBuiltInMissionByKey(key);
}

export async function listMissions(
  ctx: DbCtx,
  args?: {
    publishedOnly?: boolean;
    fallbackToBuiltIns?: boolean;
    includeUnpublishedModes?: boolean;
    includeCommunity?: boolean;
    allowedTier?: AccessTier;
  },
): Promise<MissionCatalogRow[]> {
  const rows = await ctx.db.query("sim_missions").collect();
  const missions =
    rows.length === 0 && args?.fallbackToBuiltIns === true
      ? BUILT_IN_MISSION_SEED_ROWS.map((mission) => {
          const scenario = parseMissionScenarioJson(mission.scenarioJson);
          return {
            ...mission,
            reviewStatus: resolvePublisherContentReviewStatus({
              source: mission.source,
              reviewStatus: undefined,
            }),
            mode: resolveMissionMode(mission.mode),
            requiredTier: resolveRequiredTier(mission.requiredTier),
            mapTier: mapTierFromMapKey(mission.mapKey),
            scenario,
            preview: summarizeMissionScenario(scenario),
          };
        })
      : rows
          .map((row) => tryToMissionCatalogRow(row))
          .filter((row): row is MissionCatalogRow => row !== null);
  return missions
    .filter((mission) => (args?.includeCommunity === true ? true : mission.source === "official"))
    .filter((mission) => (args?.publishedOnly === true ? mission.status === "published" : true))
    .filter((mission) =>
      args?.includeUnpublishedModes === true ? true : mission.mode !== "conquest_plus",
    )
    .filter((mission) =>
      args?.allowedTier === undefined ? true : missionIsAvailableForTier(mission, args.allowedTier),
    )
    .sort((left, right) => left.sortOrder - right.sortOrder || left.name.localeCompare(right.name));
}