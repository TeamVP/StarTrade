import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import {
  isPublishedContentStatus,
  resolvePublisherContentSource,
  resolvePublisherContentStatus,
  type PublisherContentSource,
  type PublisherContentStatus,
} from "./publisherAccess";

export type AccessTier = "free" | "pro";
export type MissionMode = "conquest_core" | "conquest_plus" | "trader_economy";

type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
type JsonObject = { [key: string]: JsonValue };

export type MapTier = "small" | "medium" | "large";

export type MissionEmpireConfig = {
  targetEmpireKey: string | null;
  targetNpcPlayerKey: string | null;
  controller: "human" | "npc" | null;
  strategyLibraryKey: string | null;
  strategyStartMode: "turn" | "attacked" | null;
  strategyStartTurn: number | null;
  treasuryDelta: number;
  homeworldPopulationDelta: number;
  homeworldStockFoodDelta: number;
  homeworldStockWeaponsDelta: number;
  homeworldStockResearchDelta: number;
  homeworldLocalTreasuryDelta: number;
  empireNameOverride: string | null;
  playerNameOverride: string | null;
};

export type MissionScenario = {
  playerEmpireKey: string;
  npcEmpireKeys: string[];
  automatedEmpireKeys: string[];
  empireConfigs: MissionEmpireConfig[];
};

export type MissionCatalogRecord = Doc<"sim_missions">;

export type MissionCatalogRow = {
  key: string;
  name: string;
  description: string;
  mapKey: string;
  ownerUserId: Id<"users"> | null;
  source: PublisherContentSource;
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
    playerEmpireKey: string;
    npcEmpireCount: number;
    automatedEmpireCount: number;
    delayedAutomationCount: number;
    handicapCount: number;
  };
  createdAt: number;
  updatedAt: number;
};

export type MissionCatalogSeedRow = Omit<
  MissionCatalogRow,
  "mapTier" | "scenario" | "preview"
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

function asStringArray(value: JsonValue | undefined, label: string): string[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array.`);
  }
  return value.map((entry, index) => asString(entry, `${label}[${index}]`));
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

function asNullableController(value: JsonValue | undefined): MissionEmpireConfig["controller"] {
  if (value === undefined || value === null) {
    return null;
  }
  if (value === "human" || value === "npc") {
    return value;
  }
  throw new Error("Mission empire config controller must be 'human' or 'npc'.");
}

function asNullableStrategyStartMode(
  value: JsonValue | undefined,
): MissionEmpireConfig["strategyStartMode"] {
  if (value === undefined || value === null) {
    return null;
  }
  if (value === "turn" || value === "attacked") {
    return value;
  }
  throw new Error("Mission empire config strategyStartMode must be 'turn' or 'attacked'.");
}

function mapMissionEmpireConfig(value: JsonValue, index: number): MissionEmpireConfig {
  const config = asJsonObject(value, `Mission scenario empireConfigs[${index}]`);
  const missionConfig: MissionEmpireConfig = {
    targetEmpireKey: asNullableString(config.targetEmpireKey, `empireConfigs[${index}].targetEmpireKey`),
    targetNpcPlayerKey: asNullableString(
      config.targetNpcPlayerKey,
      `empireConfigs[${index}].targetNpcPlayerKey`,
    ),
    controller: asNullableController(config.controller),
    strategyLibraryKey: asNullableString(
      config.strategyLibraryKey,
      `empireConfigs[${index}].strategyLibraryKey`,
    ),
    strategyStartMode: asNullableStrategyStartMode(config.strategyStartMode),
    strategyStartTurn: asNullableInteger(
      config.strategyStartTurn,
      `empireConfigs[${index}].strategyStartTurn`,
    ),
    treasuryDelta: asNumberWithDefault(config.treasuryDelta, 0, `empireConfigs[${index}].treasuryDelta`),
    homeworldPopulationDelta: asNumberWithDefault(
      config.homeworldPopulationDelta,
      0,
      `empireConfigs[${index}].homeworldPopulationDelta`,
    ),
    homeworldStockFoodDelta: asNumberWithDefault(
      config.homeworldStockFoodDelta,
      0,
      `empireConfigs[${index}].homeworldStockFoodDelta`,
    ),
    homeworldStockWeaponsDelta: asNumberWithDefault(
      config.homeworldStockWeaponsDelta,
      0,
      `empireConfigs[${index}].homeworldStockWeaponsDelta`,
    ),
    homeworldStockResearchDelta: asNumberWithDefault(
      config.homeworldStockResearchDelta,
      0,
      `empireConfigs[${index}].homeworldStockResearchDelta`,
    ),
    homeworldLocalTreasuryDelta: asNumberWithDefault(
      config.homeworldLocalTreasuryDelta,
      0,
      `empireConfigs[${index}].homeworldLocalTreasuryDelta`,
    ),
    empireNameOverride: asNullableString(
      config.empireNameOverride,
      `empireConfigs[${index}].empireNameOverride`,
    ),
    playerNameOverride: asNullableString(
      config.playerNameOverride,
      `empireConfigs[${index}].playerNameOverride`,
    ),
  };

  if (missionConfig.targetEmpireKey === null && missionConfig.targetNpcPlayerKey === null) {
    throw new Error(`empireConfigs[${index}] must target an empireKey or npcPlayerKey.`);
  }

  return missionConfig;
}

export function parseMissionScenarioJson(scenarioJson: string): MissionScenario {
  const scenario = parseJsonObjectString(scenarioJson, "Mission scenario JSON");
  const playerEmpireKey = asString(scenario.playerEmpireKey, "Mission scenario playerEmpireKey");
  const npcEmpireKeys = asStringArray(scenario.npcEmpireKeys, "Mission scenario npcEmpireKeys");
  const automatedEmpireKeys = asStringArray(
    scenario.automatedEmpireKeys,
    "Mission scenario automatedEmpireKeys",
  );
  const empireConfigValues = scenario.empireConfigs;
  if (empireConfigValues !== undefined && !Array.isArray(empireConfigValues)) {
    throw new Error("Mission scenario empireConfigs must be an array.");
  }

  return {
    playerEmpireKey,
    npcEmpireKeys,
    automatedEmpireKeys,
    empireConfigs:
      empireConfigValues === undefined
        ? []
        : empireConfigValues.map((entry, index) => mapMissionEmpireConfig(entry, index)),
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
  const delayedAutomationCount = scenario.empireConfigs.filter(
    (config) => config.strategyStartMode !== null || config.strategyStartTurn !== null,
  ).length;
  const handicapCount = scenario.empireConfigs.filter(
    (config) =>
      config.treasuryDelta !== 0 ||
      config.homeworldPopulationDelta !== 0 ||
      config.homeworldStockFoodDelta !== 0 ||
      config.homeworldStockWeaponsDelta !== 0 ||
      config.homeworldStockResearchDelta !== 0 ||
      config.homeworldLocalTreasuryDelta !== 0,
  ).length;

  return {
    playerEmpireKey: scenario.playerEmpireKey,
    npcEmpireCount: scenario.npcEmpireKeys.length,
    automatedEmpireCount: scenario.automatedEmpireKeys.length,
    delayedAutomationCount,
    handicapCount,
  };
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
      playerEmpireKey: "aurora",
      npcEmpireKeys: [],
      automatedEmpireKeys: ["iron"],
      empireConfigs: [
        {
          targetEmpireKey: "aurora",
          targetNpcPlayerKey: null,
          controller: "human",
          strategyLibraryKey: null,
          strategyStartMode: null,
          strategyStartTurn: null,
          treasuryDelta: 0,
          homeworldPopulationDelta: 0,
          homeworldStockFoodDelta: 0,
          homeworldStockWeaponsDelta: 0,
          homeworldStockResearchDelta: 0,
          homeworldLocalTreasuryDelta: 0,
          empireNameOverride: null,
          playerNameOverride: null,
        },
        {
          targetEmpireKey: "iron",
          targetNpcPlayerKey: null,
          controller: "npc",
          strategyLibraryKey: null,
          strategyStartMode: "turn",
          strategyStartTurn: 3,
          treasuryDelta: 0,
          homeworldPopulationDelta: 0,
          homeworldStockFoodDelta: 0,
          homeworldStockWeaponsDelta: 0,
          homeworldStockResearchDelta: 0,
          homeworldLocalTreasuryDelta: 0,
          empireNameOverride: null,
          playerNameOverride: null,
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
      playerEmpireKey: "aurora",
      npcEmpireKeys: [],
      automatedEmpireKeys: ["iron"],
      empireConfigs: [
        {
          targetEmpireKey: "aurora",
          targetNpcPlayerKey: null,
          controller: "human",
          strategyLibraryKey: null,
          strategyStartMode: null,
          strategyStartTurn: null,
          treasuryDelta: 0,
          homeworldPopulationDelta: 0,
          homeworldStockFoodDelta: 0,
          homeworldStockWeaponsDelta: 0,
          homeworldStockResearchDelta: 0,
          homeworldLocalTreasuryDelta: 0,
          empireNameOverride: null,
          playerNameOverride: null,
        },
        {
          targetEmpireKey: "iron",
          targetNpcPlayerKey: null,
          controller: "npc",
          strategyLibraryKey: null,
          strategyStartMode: null,
          strategyStartTurn: null,
          treasuryDelta: 0,
          homeworldPopulationDelta: 0,
          homeworldStockFoodDelta: 0,
          homeworldStockWeaponsDelta: 0,
          homeworldStockResearchDelta: 0,
          homeworldLocalTreasuryDelta: 0,
          empireNameOverride: null,
          playerNameOverride: null,
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
      playerEmpireKey: "aurora",
      npcEmpireKeys: ["maia-solenne"],
      automatedEmpireKeys: ["iron", "npc-maia-solenne"],
      empireConfigs: [
        {
          targetEmpireKey: "aurora",
          targetNpcPlayerKey: null,
          controller: "human",
          strategyLibraryKey: null,
          strategyStartMode: null,
          strategyStartTurn: null,
          treasuryDelta: 0,
          homeworldPopulationDelta: 0,
          homeworldStockFoodDelta: 0,
          homeworldStockWeaponsDelta: 0,
          homeworldStockResearchDelta: 0,
          homeworldLocalTreasuryDelta: 0,
          empireNameOverride: null,
          playerNameOverride: null,
        },
        {
          targetEmpireKey: "iron",
          targetNpcPlayerKey: null,
          controller: "npc",
          strategyLibraryKey: null,
          strategyStartMode: null,
          strategyStartTurn: null,
          treasuryDelta: 0,
          homeworldPopulationDelta: 0,
          homeworldStockFoodDelta: 0,
          homeworldStockWeaponsDelta: 0,
          homeworldStockResearchDelta: 0,
          homeworldLocalTreasuryDelta: 0,
          empireNameOverride: null,
          playerNameOverride: null,
        },
        {
          targetEmpireKey: "npc-maia-solenne",
          targetNpcPlayerKey: "maia-solenne",
          controller: "npc",
          strategyLibraryKey: null,
          strategyStartMode: "turn",
          strategyStartTurn: 2,
          treasuryDelta: -150,
          homeworldPopulationDelta: -5000000,
          homeworldStockFoodDelta: -400,
          homeworldStockWeaponsDelta: -20,
          homeworldStockResearchDelta: -10,
          homeworldLocalTreasuryDelta: -100,
          empireNameOverride: null,
          playerNameOverride: null,
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
            mode: resolveMissionMode(mission.mode),
            requiredTier: resolveRequiredTier(mission.requiredTier),
            mapTier: mapTierFromMapKey(mission.mapKey),
            scenario,
            preview: summarizeMissionScenario(scenario),
          };
        })
      : rows.map((row) => toMissionCatalogRow(row));
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