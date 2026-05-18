import { FormEvent, useDeferredValue, useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { useSearchParams } from "react-router-dom";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

type MissionPreview = {
  playerEmpireKey: string;
  npcEmpireCount: number;
  automatedEmpireCount: number;
  delayedAutomationCount: number;
  handicapCount: number;
};

type MissionRow = {
  key: string;
  name: string;
  description: string;
  mapKey: string;
  ownerUserId: Id<"users"> | null;
  ownerLabel: string | null;
  source: "official" | "community";
  reviewStatus: "unreviewed" | "needs_changes" | "approved";
  status: "draft" | "published" | "archived" | "deleted" | "admin_deleted";
  mode: "conquest_core" | "conquest_plus" | "trader_economy";
  requiredTier: "free" | "pro";
  mapTier: "small" | "medium" | "large";
  level: number;
  requiredWins: number;
  prerequisiteMissionKeys: string[];
  published: boolean;
  sortOrder: number;
  retentionClass: "discarded" | "official" | "archived_debug";
  scenarioJson: string;
  preview: MissionPreview;
  moderationHistory: Array<{
    action: "created" | "updated" | "bulk_status_updated" | "bulk_owner_updated" | "bulk_source_updated";
    summary: string;
    note: string | null;
    createdAt: number;
    actorLabel: string | null;
  }>;
  createdAt: number;
  updatedAt: number;
};

type AssignableOwnerRow = {
  _id: Id<"users">;
  name: string | null;
  email: string | null;
  admin: boolean;
  publisher: boolean;
};

function ownerOptionLabel(owner: AssignableOwnerRow): string {
  return owner.name?.trim() || owner.email?.trim() || owner._id;
}

function statusTone(status: MissionRow["status"]): string {
  switch (status) {
    case "published":
      return "border-emerald-500/40 bg-emerald-950/30 text-emerald-200";
    case "draft":
      return "border-amber-500/40 bg-amber-950/30 text-amber-200";
    case "archived":
      return "border-slate-500/40 bg-slate-900/40 text-slate-200";
    case "deleted":
    case "admin_deleted":
      return "border-red-500/40 bg-red-950/30 text-red-200";
    default:
      return "border-st-border text-st-muted";
  }
}

function reviewTone(reviewStatus: MissionRow["reviewStatus"]): string {
  switch (reviewStatus) {
    case "approved":
      return "border-emerald-500/40 bg-emerald-950/30 text-emerald-200";
    case "needs_changes":
      return "border-rose-500/40 bg-rose-950/30 text-rose-200";
    case "unreviewed":
    default:
      return "border-amber-500/40 bg-amber-950/30 text-amber-200";
  }
}

type StrategyOption = {
  key: string;
  name: string;
  availableForNpcs: boolean;
};

type EmpireNpcRow = {
  key: string;
  playerName: string;
  empireName: string;
  isActive: boolean;
};

type MissionEmpireConfig = {
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

type MissionScenario = {
  playerEmpireKey: string;
  npcEmpireKeys: string[];
  automatedEmpireKeys: string[];
  empireConfigs: MissionEmpireConfig[];
};

type MissionScenarioWarning = {
  key: string;
  message: string;
  action:
    | { kind: "addNpcSeed"; npcKey: string; label: string }
    | { kind: "setControllerNpc"; index: number; label: string }
    | { kind: "setControllerHuman"; index: number; label: string }
    | null;
};

function mutationErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  return raw.replace(/^[\s\S]*?Error:\s*/g, "").trim() || "Something went wrong.";
}

function formatTimestamp(value: number): string {
  if (value <= 0) {
    return "Built-in";
  }
  return new Date(value).toLocaleString();
}

function parseCsv(text: string): string[] {
  return text
    .split(/[\n,]/)
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

function formatCsv(values: string[]): string {
  return values.join(", ");
}

function normalizeSearchText(value: string): string {
  return value.trim().toLowerCase();
}

function readMissionSourceFilter(value: string | null): "all" | MissionRow["source"] {
  return value === "official" || value === "community" ? value : "all";
}

function readMissionStatusFilter(value: string | null): "all" | MissionRow["status"] {
  return value === "draft" ||
    value === "published" ||
    value === "archived" ||
    value === "deleted" ||
    value === "admin_deleted"
    ? value
    : "all";
}

function readMissionOwnerFilter(value: string | null): "all" | "system" | Id<"users"> {
  if (value === "all" || value === null || value.trim().length === 0) {
    return "all";
  }
  if (value === "system") {
    return "system";
  }
  return value as Id<"users">;
}

function readMissionReviewFilter(value: string | null): "all" | MissionRow["reviewStatus"] {
  return value === "unreviewed" || value === "needs_changes" || value === "approved"
    ? value
    : "all";
}

const MODERATION_NOTE_PRESETS = [
  "Approved after moderation review.",
  "Needs changes before approval.",
  "Metadata normalized for catalog consistency.",
  "Ownership/source updated by admin moderation.",
] as const;

function applyModerationNotePreset(currentNote: string, preset: string): string {
  const trimmed = currentNote.trim();
  if (trimmed.length === 0) {
    return preset;
  }
  if (trimmed.includes(preset)) {
    return currentNote;
  }
  return `${trimmed}\n${preset}`;
}

function ModerationNotePresets(props: {
  disabled?: boolean;
  onSelect: (preset: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {MODERATION_NOTE_PRESETS.map((preset) => (
        <Button
          key={preset}
          type="button"
          variant="outline"
          disabled={props.disabled}
          onClick={() => props.onSelect(preset)}
          className="h-auto px-2 py-1 text-[11px]"
        >
          {preset}
        </Button>
      ))}
    </div>
  );
}

function normalizeNullableString(value: string): string | null {
  const normalized = value.trim();
  return normalized.length === 0 ? null : normalized;
}

function normalizeNullableInteger(value: string): number | null {
  const normalized = value.trim();
  if (normalized.length === 0) {
    return null;
  }
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return Math.max(1, Math.floor(parsed));
}

function normalizeNumber(value: string): number {
  const normalized = value.trim();
  if (normalized.length === 0) {
    return 0;
  }
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toMissionScenarioJson(scenario: MissionScenario): string {
  return JSON.stringify(scenario, null, 2);
}

function parseMissionScenarioJson(text: string): { scenario: MissionScenario | null; error: string | null } {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return { scenario: null, error: "Scenario JSON cannot be empty." };
  }

  try {
    const parsed = JSON.parse(trimmed) as Partial<MissionScenario>;
    const scenario: MissionScenario = {
      playerEmpireKey:
        typeof parsed.playerEmpireKey === "string" && parsed.playerEmpireKey.trim().length > 0
          ? parsed.playerEmpireKey.trim()
          : "aurora",
      npcEmpireKeys: Array.isArray(parsed.npcEmpireKeys)
        ? parsed.npcEmpireKeys
            .filter((value): value is string => typeof value === "string")
            .map((value) => value.trim())
            .filter((value) => value.length > 0)
        : [],
      automatedEmpireKeys: Array.isArray(parsed.automatedEmpireKeys)
        ? parsed.automatedEmpireKeys
            .filter((value): value is string => typeof value === "string")
            .map((value) => value.trim())
            .filter((value) => value.length > 0)
        : [],
      empireConfigs: Array.isArray(parsed.empireConfigs)
        ? parsed.empireConfigs.map((config) => {
            const row = (config ?? {}) as Partial<MissionEmpireConfig>;
            return {
              targetEmpireKey:
                typeof row.targetEmpireKey === "string" && row.targetEmpireKey.trim().length > 0
                  ? row.targetEmpireKey.trim()
                  : null,
              targetNpcPlayerKey:
                typeof row.targetNpcPlayerKey === "string" && row.targetNpcPlayerKey.trim().length > 0
                  ? row.targetNpcPlayerKey.trim()
                  : null,
              controller: row.controller === "human" || row.controller === "npc" ? row.controller : null,
              strategyLibraryKey:
                typeof row.strategyLibraryKey === "string" && row.strategyLibraryKey.trim().length > 0
                  ? row.strategyLibraryKey.trim()
                  : null,
              strategyStartMode:
                row.strategyStartMode === "turn" || row.strategyStartMode === "attacked"
                  ? row.strategyStartMode
                  : null,
              strategyStartTurn:
                typeof row.strategyStartTurn === "number" && Number.isFinite(row.strategyStartTurn)
                  ? Math.max(1, Math.floor(row.strategyStartTurn))
                  : null,
              treasuryDelta:
                typeof row.treasuryDelta === "number" && Number.isFinite(row.treasuryDelta)
                  ? row.treasuryDelta
                  : 0,
              homeworldPopulationDelta:
                typeof row.homeworldPopulationDelta === "number" && Number.isFinite(row.homeworldPopulationDelta)
                  ? row.homeworldPopulationDelta
                  : 0,
              homeworldStockFoodDelta:
                typeof row.homeworldStockFoodDelta === "number" && Number.isFinite(row.homeworldStockFoodDelta)
                  ? row.homeworldStockFoodDelta
                  : 0,
              homeworldStockWeaponsDelta:
                typeof row.homeworldStockWeaponsDelta === "number" && Number.isFinite(row.homeworldStockWeaponsDelta)
                  ? row.homeworldStockWeaponsDelta
                  : 0,
              homeworldStockResearchDelta:
                typeof row.homeworldStockResearchDelta === "number" && Number.isFinite(row.homeworldStockResearchDelta)
                  ? row.homeworldStockResearchDelta
                  : 0,
              homeworldLocalTreasuryDelta:
                typeof row.homeworldLocalTreasuryDelta === "number" && Number.isFinite(row.homeworldLocalTreasuryDelta)
                  ? row.homeworldLocalTreasuryDelta
                  : 0,
              empireNameOverride:
                typeof row.empireNameOverride === "string" && row.empireNameOverride.trim().length > 0
                  ? row.empireNameOverride.trim()
                  : null,
              playerNameOverride:
                typeof row.playerNameOverride === "string" && row.playerNameOverride.trim().length > 0
                  ? row.playerNameOverride.trim()
                  : null,
            };
          })
        : [],
    };
    return { scenario, error: null };
  } catch (error) {
    return {
      scenario: null,
      error: error instanceof Error ? error.message : "Scenario JSON must be valid JSON.",
    };
  }
}

function hasMissionHandicap(config: MissionEmpireConfig): boolean {
  return (
    config.treasuryDelta !== 0 ||
    config.homeworldPopulationDelta !== 0 ||
    config.homeworldStockFoodDelta !== 0 ||
    config.homeworldStockWeaponsDelta !== 0 ||
    config.homeworldStockResearchDelta !== 0 ||
    config.homeworldLocalTreasuryDelta !== 0
  );
}

function collectMissionScenarioWarnings(scenario: MissionScenario): MissionScenarioWarning[] {
  const warnings: MissionScenarioWarning[] = [];
  const duplicateTargets = new Set<string>();
  const seenTargets = new Set<string>();

  for (const [index, config] of scenario.empireConfigs.entries()) {
    const targetKey = config.targetEmpireKey?.trim() ?? "";
    if (targetKey.length > 0) {
      if (seenTargets.has(targetKey)) {
        duplicateTargets.add(targetKey);
      }
      seenTargets.add(targetKey);
    }

    if (config.targetEmpireKey === null && config.targetNpcPlayerKey === null) {
      warnings.push({
        key: `untargeted-${index}`,
        message: "An override row has no target empire key or NPC persona.",
        action: null,
      });
    }
    if (config.targetEmpireKey === scenario.playerEmpireKey && config.controller === "npc") {
      warnings.push({
        key: `player-npc-${index}`,
        message: `Player empire ${scenario.playerEmpireKey} is configured to be NPC-controlled.`,
        action: { kind: "setControllerHuman", index, label: "Set controller to human" },
      });
    }
    if (config.controller === "human" && config.targetNpcPlayerKey !== null) {
      warnings.push({
        key: `human-npc-persona-${index}`,
        message: `Override for ${config.targetEmpireKey ?? config.targetNpcPlayerKey} assigns an NPC persona while controller is human.`,
        action: { kind: "setControllerNpc", index, label: "Set controller to npc" },
      });
    }
  }

  for (const target of duplicateTargets) {
    warnings.push({
      key: `duplicate-target-${target}`,
      message: `Multiple override rows target the same empire key: ${target}.`,
      action: null,
    });
  }

  for (const automatedEmpireKey of scenario.automatedEmpireKeys) {
    if (automatedEmpireKey.startsWith("npc-")) {
      const npcKey = automatedEmpireKey.slice(4);
      if (!scenario.npcEmpireKeys.includes(npcKey)) {
        warnings.push({
          key: `missing-seed-${npcKey}`,
          message: `Automated empire ${automatedEmpireKey} does not have a matching NPC seed entry in npcEmpireKeys.`,
          action: { kind: "addNpcSeed", npcKey, label: `Add ${npcKey} to npcEmpireKeys` },
        });
      }
    }
  }

  return warnings;
}

function MissionScenarioPreview(props: {
  scenario: MissionScenario;
  empireNpcs: EmpireNpcRow[];
  strategies: StrategyOption[];
  onApplyWarningFix: (warning: MissionScenarioWarning) => void;
}) {
  const npcByKey = useMemo(
    () => new Map(props.empireNpcs.map((npc) => [npc.key, npc])),
    [props.empireNpcs],
  );
  const strategyByKey = useMemo(
    () => new Map(props.strategies.map((strategy) => [strategy.key, strategy])),
    [props.strategies],
  );
  const warnings = useMemo(() => collectMissionScenarioWarnings(props.scenario), [props.scenario]);

  return (
    <div className="space-y-3 rounded border border-st-border bg-st-panel px-3 py-3">
      <div>
        <h5 className="text-xs font-semibold uppercase tracking-wide text-st-muted">Live Preview</h5>
        <p className="mt-1 text-xs text-st-muted">
          Review the effective scenario composition before saving.
        </p>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <div className="rounded border border-st-border bg-st-bg px-3 py-2 text-xs text-st-muted">
          <div className="font-semibold text-st-fg">Player Empire</div>
          <div className="mt-1">{props.scenario.playerEmpireKey}</div>
        </div>
        <div className="rounded border border-st-border bg-st-bg px-3 py-2 text-xs text-st-muted">
          <div className="font-semibold text-st-fg">Seeded NPC Rivals</div>
          <div className="mt-1">
            {props.scenario.npcEmpireKeys.length === 0
              ? "None"
              : props.scenario.npcEmpireKeys
                  .map((key) => npcByKey.get(key)?.playerName ?? key)
                  .join(", ")}
          </div>
        </div>
        <div className="rounded border border-st-border bg-st-bg px-3 py-2 text-xs text-st-muted">
          <div className="font-semibold text-st-fg">Automated Empires</div>
          <div className="mt-1">
            {props.scenario.automatedEmpireKeys.length === 0
              ? "None"
              : props.scenario.automatedEmpireKeys.join(", ")}
          </div>
        </div>
      </div>

      <div className="space-y-2">
        <div className="text-xs font-semibold uppercase tracking-wide text-st-muted">Override Summary</div>
        {props.scenario.empireConfigs.length === 0 ? (
          <p className="rounded border border-st-border bg-st-bg px-3 py-2 text-xs text-st-muted">
            No empire overrides configured.
          </p>
        ) : (
          props.scenario.empireConfigs.map((config, index) => {
            const npc = config.targetNpcPlayerKey === null ? null : npcByKey.get(config.targetNpcPlayerKey) ?? null;
            const strategy =
              config.strategyLibraryKey === null ? null : strategyByKey.get(config.strategyLibraryKey) ?? null;
            return (
              <div
                key={`${config.targetEmpireKey ?? config.targetNpcPlayerKey ?? "override"}-${index}`}
                className="rounded border border-st-border bg-st-bg px-3 py-2 text-xs text-st-muted"
              >
                <div className="font-semibold text-st-fg">
                  {config.targetEmpireKey ?? config.targetNpcPlayerKey ?? `Override ${index + 1}`}
                </div>
                <div className="mt-1">
                  Commander: {npc?.playerName ?? config.targetNpcPlayerKey ?? "none"} · Controller: {config.controller ?? "unchanged"}
                </div>
                <div className="mt-1">
                  Strategy: {strategy?.name ?? config.strategyLibraryKey ?? "NPC default / none"}
                  {config.strategyStartMode !== null || config.strategyStartTurn !== null
                    ? ` · Delay ${config.strategyStartMode ?? "turn"}${config.strategyStartTurn !== null ? ` ${config.strategyStartTurn}` : ""}`
                    : ""}
                </div>
                <div className="mt-1">
                  Handicap: {hasMissionHandicap(config) ? "yes" : "none"}
                  {config.empireNameOverride !== null ? ` · Empire name ${config.empireNameOverride}` : ""}
                  {config.playerNameOverride !== null ? ` · Player name ${config.playerNameOverride}` : ""}
                </div>
              </div>
            );
          })
        )}
      </div>

      {warnings.length > 0 ? (
        <div className="space-y-2 rounded border border-amber-900/50 bg-amber-950/30 px-3 py-3 text-xs text-amber-100">
          <div className="font-semibold text-amber-200">Authoring Warnings</div>
          <ul className="space-y-1">
            {warnings.map((warning) => {
              const action = warning.action;
              return (
                <li key={warning.key} className="flex flex-wrap items-center justify-between gap-2">
                  <span>{warning.message}</span>
                  {action !== null ? (
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => props.onApplyWarningFix(warning)}
                    >
                      {action.label}
                    </Button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function MissionScenarioEditor(props: {
  scenarioJson: string;
  onScenarioJsonChange: (value: string) => void;
  empireNpcs: EmpireNpcRow[];
  strategies: StrategyOption[];
}) {
  const parsed = useMemo(() => parseMissionScenarioJson(props.scenarioJson), [props.scenarioJson]);
  const [presetEmpireKey, setPresetEmpireKey] = useState("iron");
  const [presetNpcKey, setPresetNpcKey] = useState("");

  function updateScenario(updater: (scenario: MissionScenario) => MissionScenario) {
    if (parsed.scenario === null) {
      return;
    }
    props.onScenarioJsonChange(toMissionScenarioJson(updater(parsed.scenario)));
  }

  function updateConfig(index: number, updater: (config: MissionEmpireConfig) => MissionEmpireConfig) {
    updateScenario((scenario) => ({
      ...scenario,
      empireConfigs: scenario.empireConfigs.map((config, configIndex) =>
        configIndex === index ? updater(config) : config,
      ),
    }));
  }

  function upsertConfig(
    matcher: (config: MissionEmpireConfig) => boolean,
    create: () => MissionEmpireConfig,
    updater: (config: MissionEmpireConfig) => MissionEmpireConfig,
  ) {
    updateScenario((scenario) => {
      const existingIndex = scenario.empireConfigs.findIndex(matcher);
      if (existingIndex === -1) {
        return {
          ...scenario,
          empireConfigs: [...scenario.empireConfigs, updater(create())],
        };
      }
      return {
        ...scenario,
        empireConfigs: scenario.empireConfigs.map((config, index) =>
          index === existingIndex ? updater(config) : config,
        ),
      };
    });
  }

  function createEmptyConfig(): MissionEmpireConfig {
    return {
      targetEmpireKey: null,
      targetNpcPlayerKey: null,
      controller: null,
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
    };
  }

  function addCommanderPreset() {
    const empireKey = presetEmpireKey.trim();
    const npcKey = presetNpcKey.trim();
    if (empireKey.length === 0 || npcKey.length === 0) {
      return;
    }
    upsertConfig(
      (config) => config.targetEmpireKey === empireKey,
      () => ({ ...createEmptyConfig(), targetEmpireKey: empireKey }),
      (config) => ({
        ...config,
        targetEmpireKey: empireKey,
        targetNpcPlayerKey: npcKey,
        controller: "npc",
      }),
    );
  }

  function addSeededRivalPreset() {
    const npcKey = presetNpcKey.trim();
    if (npcKey.length === 0) {
      return;
    }
    const seededEmpireKey = `npc-${npcKey}`;
    updateScenario((scenario) => {
      const npcEmpireKeys = scenario.npcEmpireKeys.includes(npcKey)
        ? scenario.npcEmpireKeys
        : [...scenario.npcEmpireKeys, npcKey];
      const automatedEmpireKeys = scenario.automatedEmpireKeys.includes(seededEmpireKey)
        ? scenario.automatedEmpireKeys
        : [...scenario.automatedEmpireKeys, seededEmpireKey];
      const existingIndex = scenario.empireConfigs.findIndex(
        (config) => config.targetEmpireKey === seededEmpireKey,
      );
      const nextConfig = {
        ...(existingIndex === -1 ? createEmptyConfig() : scenario.empireConfigs[existingIndex]),
        targetEmpireKey: seededEmpireKey,
        targetNpcPlayerKey: npcKey,
        controller: "npc" as const,
      };
      const empireConfigs =
        existingIndex === -1
          ? [...scenario.empireConfigs, nextConfig]
          : scenario.empireConfigs.map((config, index) =>
              index === existingIndex ? nextConfig : config,
            );
      return {
        ...scenario,
        npcEmpireKeys,
        automatedEmpireKeys,
        empireConfigs,
      };
    });
  }

  function addDelayPreset() {
    const empireKey = presetEmpireKey.trim();
    if (empireKey.length === 0) {
      return;
    }
    upsertConfig(
      (config) => config.targetEmpireKey === empireKey,
      () => ({ ...createEmptyConfig(), targetEmpireKey: empireKey }),
      (config) => ({
        ...config,
        targetEmpireKey: empireKey,
        controller: config.controller ?? "npc",
        strategyStartMode: "turn",
        strategyStartTurn: config.strategyStartTurn ?? 2,
      }),
    );
  }

  function addHandicapPreset() {
    const empireKey = presetEmpireKey.trim();
    if (empireKey.length === 0) {
      return;
    }
    upsertConfig(
      (config) => config.targetEmpireKey === empireKey,
      () => ({ ...createEmptyConfig(), targetEmpireKey: empireKey }),
      (config) => ({
        ...config,
        targetEmpireKey: empireKey,
        treasuryDelta: config.treasuryDelta !== 0 ? config.treasuryDelta : -150,
        homeworldPopulationDelta:
          config.homeworldPopulationDelta !== 0 ? config.homeworldPopulationDelta : -5000000,
        homeworldStockFoodDelta: config.homeworldStockFoodDelta !== 0 ? config.homeworldStockFoodDelta : -400,
        homeworldStockWeaponsDelta:
          config.homeworldStockWeaponsDelta !== 0 ? config.homeworldStockWeaponsDelta : -20,
        homeworldStockResearchDelta:
          config.homeworldStockResearchDelta !== 0 ? config.homeworldStockResearchDelta : -10,
        homeworldLocalTreasuryDelta:
          config.homeworldLocalTreasuryDelta !== 0 ? config.homeworldLocalTreasuryDelta : -100,
      }),
    );
  }

  function applyWarningFix(warning: MissionScenarioWarning) {
    const action = warning.action;
    if (action === null) {
      return;
    }

    if (action.kind === "addNpcSeed") {
      updateScenario((scenario) => ({
        ...scenario,
        npcEmpireKeys: scenario.npcEmpireKeys.includes(action.npcKey)
          ? scenario.npcEmpireKeys
          : [...scenario.npcEmpireKeys, action.npcKey],
      }));
      return;
    }

    if (action.kind === "setControllerNpc") {
      updateConfig(action.index, (current) => ({
        ...current,
        controller: "npc",
      }));
      return;
    }

    if (action.kind === "setControllerHuman") {
      updateConfig(action.index, (current) => ({
        ...current,
        controller: "human",
      }));
    }
  }

  return (
    <div className="space-y-4 rounded-lg border border-st-border bg-st-bg/40 p-4">
      <div>
        <h4 className="text-sm font-semibold text-st-fg">Scenario Builder</h4>
        <p className="mt-1 text-xs text-st-muted">
          Use the structured controls for common mission setup, then fine-tune the raw JSON if needed.
        </p>
      </div>

      {parsed.error !== null ? (
        <p className="rounded border border-red-900/50 bg-red-950/30 px-3 py-2 text-xs text-red-200">
          Fix the raw scenario JSON to continue using the structured editor: {parsed.error}
        </p>
      ) : null}

      <div className="grid gap-3 md:grid-cols-3">
        <label className="grid gap-1 text-xs text-st-muted">
          <span>Player empire key</span>
          <input
            value={parsed.scenario?.playerEmpireKey ?? ""}
            disabled={parsed.scenario === null}
            onChange={(event) => {
              updateScenario((scenario) => ({
                ...scenario,
                playerEmpireKey: event.target.value.trim() || "aurora",
              }));
            }}
            className="rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-fg outline-none focus:border-st-accent disabled:opacity-60"
          />
        </label>
        <label className="grid gap-1 text-xs text-st-muted md:col-span-2">
          <span>Seeded NPC empire keys</span>
          <input
            value={parsed.scenario ? formatCsv(parsed.scenario.npcEmpireKeys) : ""}
            disabled={parsed.scenario === null}
            placeholder="maia-solenne, tomas-varek"
            onChange={(event) => {
              updateScenario((scenario) => ({
                ...scenario,
                npcEmpireKeys: parseCsv(event.target.value),
              }));
            }}
            className="rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-fg outline-none focus:border-st-accent disabled:opacity-60"
          />
        </label>
      </div>

      <label className="grid gap-1 text-xs text-st-muted">
        <span>Automated empire keys</span>
        <input
          value={parsed.scenario ? formatCsv(parsed.scenario.automatedEmpireKeys) : ""}
          disabled={parsed.scenario === null}
          placeholder="iron, npc-maia-solenne"
          onChange={(event) => {
            updateScenario((scenario) => ({
              ...scenario,
              automatedEmpireKeys: parseCsv(event.target.value),
            }));
          }}
          className="rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-fg outline-none focus:border-st-accent disabled:opacity-60"
        />
      </label>

      <div className="space-y-3 rounded border border-st-border bg-st-panel px-3 py-3">
        <div>
          <h5 className="text-xs font-semibold uppercase tracking-wide text-st-muted">Quick Presets</h5>
          <p className="mt-1 text-xs text-st-muted">
            Use these shortcuts to generate the most common mission edits without touching the raw JSON.
          </p>
        </div>

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[minmax(0,1fr),minmax(0,1fr),auto,auto]">
          <label className="grid gap-1 text-xs text-st-muted">
            <span>Existing empire key</span>
            <input
              value={presetEmpireKey}
              disabled={parsed.scenario === null}
              onChange={(event) => setPresetEmpireKey(event.target.value)}
              placeholder="iron"
              className="rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-fg outline-none focus:border-st-accent disabled:opacity-60"
            />
          </label>
          <label className="grid gap-1 text-xs text-st-muted">
            <span>NPC persona</span>
            <select
              value={presetNpcKey}
              disabled={parsed.scenario === null}
              onChange={(event) => setPresetNpcKey(event.target.value)}
              className="rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-fg outline-none focus:border-st-accent disabled:opacity-60"
            >
              <option value="">Choose NPC persona</option>
              {props.empireNpcs.map((npc) => (
                <option key={npc.key} value={npc.key}>
                  {npc.playerName} ({npc.key})
                </option>
              ))}
            </select>
          </label>
          <div className="flex items-end">
            <Button type="button" variant="secondary" disabled={parsed.scenario === null || presetNpcKey.trim().length === 0} onClick={addCommanderPreset}>
              Assign commander
            </Button>
          </div>
          <div className="flex items-end">
            <Button type="button" variant="secondary" disabled={parsed.scenario === null || presetNpcKey.trim().length === 0} onClick={addSeededRivalPreset}>
              Add seeded rival
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="secondary" disabled={parsed.scenario === null || presetEmpireKey.trim().length === 0} onClick={addDelayPreset}>
            Delay AI start
          </Button>
          <Button type="button" variant="secondary" disabled={parsed.scenario === null || presetEmpireKey.trim().length === 0} onClick={addHandicapPreset}>
            Apply light handicap
          </Button>
        </div>
      </div>

      {parsed.scenario !== null ? (
        <MissionScenarioPreview
          scenario={parsed.scenario}
          empireNpcs={props.empireNpcs}
          strategies={props.strategies}
          onApplyWarningFix={applyWarningFix}
        />
      ) : null}

      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h5 className="text-xs font-semibold uppercase tracking-wide text-st-muted">Empire Overrides</h5>
            <p className="mt-1 text-xs text-st-muted">
              Assign commanders, delays, strategies, and handicap adjustments to specific empires.
            </p>
          </div>
          <Button
            type="button"
            variant="secondary"
            disabled={parsed.scenario === null}
            onClick={() => {
              updateScenario((scenario) => ({
                ...scenario,
                empireConfigs: [
                  ...scenario.empireConfigs,
                  createEmptyConfig(),
                ],
              }));
            }}
          >
            Add override
          </Button>
        </div>

        {parsed.scenario !== null && parsed.scenario.empireConfigs.length === 0 ? (
          <p className="rounded border border-st-border bg-st-bg px-3 py-2 text-xs text-st-muted">
            No empire overrides yet. Add one to assign a commanding NPC, automation timing, or mission handicap.
          </p>
        ) : null}

        {parsed.scenario?.empireConfigs.map((config, index) => (
          <div key={`${config.targetEmpireKey ?? "empire"}-${index}`} className="space-y-3 rounded border border-st-border bg-st-panel px-3 py-3">
            <div className="flex items-center justify-between gap-3">
              <div className="text-xs text-st-muted">
                Override {index + 1}
              </div>
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  updateScenario((scenario) => ({
                    ...scenario,
                    empireConfigs: scenario.empireConfigs.filter((_, configIndex) => configIndex !== index),
                  }));
                }}
              >
                Remove
              </Button>
            </div>

            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <label className="grid gap-1 text-xs text-st-muted">
                <span>Target empire key</span>
                <input
                  value={config.targetEmpireKey ?? ""}
                  onChange={(event) => {
                    updateConfig(index, (current) => ({
                      ...current,
                      targetEmpireKey: normalizeNullableString(event.target.value),
                    }));
                  }}
                  placeholder="iron"
                  className="rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-fg outline-none focus:border-st-accent"
                />
              </label>
              <label className="grid gap-1 text-xs text-st-muted">
                <span>Commanding NPC</span>
                <select
                  value={config.targetNpcPlayerKey ?? ""}
                  onChange={(event) => {
                    updateConfig(index, (current) => ({
                      ...current,
                      targetNpcPlayerKey: normalizeNullableString(event.target.value),
                    }));
                  }}
                  className="rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-fg outline-none focus:border-st-accent"
                >
                  <option value="">No NPC persona</option>
                  {props.empireNpcs.map((npc) => (
                    <option key={npc.key} value={npc.key}>
                      {npc.playerName} ({npc.key})
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1 text-xs text-st-muted">
                <span>Controller</span>
                <select
                  value={config.controller ?? ""}
                  onChange={(event) => {
                    const value = event.target.value;
                    updateConfig(index, (current) => ({
                      ...current,
                      controller: value === "human" || value === "npc" ? value : null,
                    }));
                  }}
                  className="rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-fg outline-none focus:border-st-accent"
                >
                  <option value="">No override</option>
                  <option value="human">human</option>
                  <option value="npc">npc</option>
                </select>
              </label>
              <label className="grid gap-1 text-xs text-st-muted">
                <span>Strategy</span>
                <select
                  value={config.strategyLibraryKey ?? ""}
                  onChange={(event) => {
                    updateConfig(index, (current) => ({
                      ...current,
                      strategyLibraryKey: normalizeNullableString(event.target.value),
                    }));
                  }}
                  className="rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-fg outline-none focus:border-st-accent"
                >
                  <option value="">Use NPC default / none</option>
                  {props.strategies.map((strategy) => (
                    <option key={strategy.key} value={strategy.key}>
                      {strategy.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <label className="grid gap-1 text-xs text-st-muted">
                <span>Strategy start mode</span>
                <select
                  value={config.strategyStartMode ?? ""}
                  onChange={(event) => {
                    const value = event.target.value;
                    updateConfig(index, (current) => ({
                      ...current,
                      strategyStartMode: value === "turn" || value === "attacked" ? value : null,
                    }));
                  }}
                  className="rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-fg outline-none focus:border-st-accent"
                >
                  <option value="">No delay</option>
                  <option value="turn">turn</option>
                  <option value="attacked">attacked</option>
                </select>
              </label>
              <label className="grid gap-1 text-xs text-st-muted">
                <span>Strategy start turn</span>
                <input
                  type="number"
                  min={1}
                  step={1}
                  value={config.strategyStartTurn ?? ""}
                  onChange={(event) => {
                    updateConfig(index, (current) => ({
                      ...current,
                      strategyStartTurn: normalizeNullableInteger(event.target.value),
                    }));
                  }}
                  className="rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-fg outline-none focus:border-st-accent"
                />
              </label>
              <label className="grid gap-1 text-xs text-st-muted">
                <span>Empire name override</span>
                <input
                  value={config.empireNameOverride ?? ""}
                  onChange={(event) => {
                    updateConfig(index, (current) => ({
                      ...current,
                      empireNameOverride: normalizeNullableString(event.target.value),
                    }));
                  }}
                  className="rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-fg outline-none focus:border-st-accent"
                />
              </label>
              <label className="grid gap-1 text-xs text-st-muted">
                <span>Player name override</span>
                <input
                  value={config.playerNameOverride ?? ""}
                  onChange={(event) => {
                    updateConfig(index, (current) => ({
                      ...current,
                      playerNameOverride: normalizeNullableString(event.target.value),
                    }));
                  }}
                  className="rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-fg outline-none focus:border-st-accent"
                />
              </label>
            </div>

            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              <label className="grid gap-1 text-xs text-st-muted">
                <span>Treasury delta</span>
                <input
                  type="number"
                  step={1}
                  value={config.treasuryDelta}
                  onChange={(event) => {
                    updateConfig(index, (current) => ({
                      ...current,
                      treasuryDelta: normalizeNumber(event.target.value),
                    }));
                  }}
                  className="rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-fg outline-none focus:border-st-accent"
                />
              </label>
              <label className="grid gap-1 text-xs text-st-muted">
                <span>Homeworld population delta</span>
                <input
                  type="number"
                  step={1}
                  value={config.homeworldPopulationDelta}
                  onChange={(event) => {
                    updateConfig(index, (current) => ({
                      ...current,
                      homeworldPopulationDelta: normalizeNumber(event.target.value),
                    }));
                  }}
                  className="rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-fg outline-none focus:border-st-accent"
                />
              </label>
              <label className="grid gap-1 text-xs text-st-muted">
                <span>Homeworld food delta</span>
                <input
                  type="number"
                  step={1}
                  value={config.homeworldStockFoodDelta}
                  onChange={(event) => {
                    updateConfig(index, (current) => ({
                      ...current,
                      homeworldStockFoodDelta: normalizeNumber(event.target.value),
                    }));
                  }}
                  className="rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-fg outline-none focus:border-st-accent"
                />
              </label>
              <label className="grid gap-1 text-xs text-st-muted">
                <span>Homeworld weapons delta</span>
                <input
                  type="number"
                  step={1}
                  value={config.homeworldStockWeaponsDelta}
                  onChange={(event) => {
                    updateConfig(index, (current) => ({
                      ...current,
                      homeworldStockWeaponsDelta: normalizeNumber(event.target.value),
                    }));
                  }}
                  className="rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-fg outline-none focus:border-st-accent"
                />
              </label>
              <label className="grid gap-1 text-xs text-st-muted">
                <span>Homeworld research delta</span>
                <input
                  type="number"
                  step={1}
                  value={config.homeworldStockResearchDelta}
                  onChange={(event) => {
                    updateConfig(index, (current) => ({
                      ...current,
                      homeworldStockResearchDelta: normalizeNumber(event.target.value),
                    }));
                  }}
                  className="rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-fg outline-none focus:border-st-accent"
                />
              </label>
              <label className="grid gap-1 text-xs text-st-muted">
                <span>Homeworld local treasury delta</span>
                <input
                  type="number"
                  step={1}
                  value={config.homeworldLocalTreasuryDelta}
                  onChange={(event) => {
                    updateConfig(index, (current) => ({
                      ...current,
                      homeworldLocalTreasuryDelta: normalizeNumber(event.target.value),
                    }));
                  }}
                  className="rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-fg outline-none focus:border-st-accent"
                />
              </label>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function MissionSummary(props: { preview: MissionPreview }) {
  return (
    <div className="flex flex-wrap gap-2 text-xs text-st-muted">
      <span className="rounded border border-st-border px-2 py-0.5">
        Player {props.preview.playerEmpireKey}
      </span>
      <span className="rounded border border-st-border px-2 py-0.5">
        NPC picks {props.preview.npcEmpireCount}
      </span>
      <span className="rounded border border-st-border px-2 py-0.5">
        Automated empires {props.preview.automatedEmpireCount}
      </span>
      <span className="rounded border border-st-border px-2 py-0.5">
        Delayed automation {props.preview.delayedAutomationCount}
      </span>
      <span className="rounded border border-st-border px-2 py-0.5">
        Handicaps {props.preview.handicapCount}
      </span>
    </div>
  );
}

function MissionCard(props: {
  mission: MissionRow;
  selected: boolean;
  onToggleSelect: (key: string) => void;
  empireNpcs: EmpireNpcRow[];
  strategies: StrategyOption[];
  ownerOptions: AssignableOwnerRow[];
  onSave: (args: {
    key: string;
    name: string;
    description: string;
    mapKey: string;
    ownerUserId: Id<"users"> | null;
    source: MissionRow["source"];
    reviewStatus: MissionRow["reviewStatus"];
    status: MissionRow["status"];
    mode: MissionRow["mode"];
    requiredTier: MissionRow["requiredTier"];
    level: number;
    requiredWins: number;
    prerequisiteMissionKeys: string[];
    published: boolean;
    sortOrder: number;
    retentionClass: MissionRow["retentionClass"];
    scenarioJson: string;
    moderationNote: string;
  }) => Promise<void>;
}) {
  const [name, setName] = useState(props.mission.name);
  const [description, setDescription] = useState(props.mission.description);
  const [mapKey, setMapKey] = useState(props.mission.mapKey);
  const [ownerUserId, setOwnerUserId] = useState<Id<"users"> | "">(props.mission.ownerUserId ?? "");
  const [source, setSource] = useState<MissionRow["source"]>(props.mission.source);
  const [reviewStatus, setReviewStatus] = useState<MissionRow["reviewStatus"]>(props.mission.reviewStatus);
  const [contentStatus, setContentStatus] = useState<MissionRow["status"]>(props.mission.status);
  const [mode, setMode] = useState<MissionRow["mode"]>(props.mission.mode);
  const [requiredTier, setRequiredTier] = useState<MissionRow["requiredTier"]>(props.mission.requiredTier);
  const [level, setLevel] = useState(String(props.mission.level));
  const [requiredWins, setRequiredWins] = useState(String(props.mission.requiredWins));
  const [prerequisitesText, setPrerequisitesText] = useState(
    formatCsv(props.mission.prerequisiteMissionKeys),
  );
  const [sortOrder, setSortOrder] = useState(String(props.mission.sortOrder));
  const [retentionClass, setRetentionClass] = useState<MissionRow["retentionClass"]>(
    props.mission.retentionClass,
  );
  const [scenarioJson, setScenarioJson] = useState(props.mission.scenarioJson);
  const [moderationNote, setModerationNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const readOnly =
    props.mission.status === "archived" ||
    props.mission.status === "deleted" ||
    props.mission.status === "admin_deleted";

  async function handleSave() {
    setBusy(true);
    setStatus(null);
    setError(null);
    try {
      await props.onSave({
        key: props.mission.key,
        name,
        description,
        mapKey,
        ownerUserId: source === "community" ? ownerUserId || null : null,
        source,
        reviewStatus: source === "official" ? "approved" : reviewStatus,
        status: contentStatus,
        mode,
        requiredTier,
        level: Number(level),
        requiredWins: Number(requiredWins),
        prerequisiteMissionKeys: parseCsv(prerequisitesText),
        published: contentStatus === "published",
        sortOrder: Number(sortOrder),
        retentionClass,
        scenarioJson,
        moderationNote,
      });
      setModerationNote("");
      setStatus("Saved.");
    } catch (saveError) {
      setError(mutationErrorMessage(saveError));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <input
            type="checkbox"
            checked={props.selected}
            onChange={() => props.onToggleSelect(props.mission.key)}
            className="mt-1 accent-cyan-400"
            aria-label={`Select ${props.mission.key}`}
          />
          <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-st-fg">{props.mission.name}</h3>
            <span className="rounded border border-st-border px-2 py-0.5 text-xs text-st-muted">
              {props.mission.key}
            </span>
            <span className="rounded border border-st-border px-2 py-0.5 text-xs text-st-muted">
              Level {props.mission.level}
            </span>
            <span className="rounded border border-st-border px-2 py-0.5 text-xs text-st-muted">
              {props.mission.mode}
            </span>
            <span className="rounded border border-st-border px-2 py-0.5 text-xs text-st-muted">
              {props.mission.requiredTier}
            </span>
            <span className={`rounded border px-2 py-0.5 text-xs ${props.mission.source === "community" ? "border-sky-500/40 bg-sky-950/30 text-sky-200" : "border-st-border text-st-muted"}`}>
              {props.mission.source}
            </span>
            <span className={`rounded border px-2 py-0.5 text-xs ${reviewTone(props.mission.reviewStatus)}`}>
              review {props.mission.reviewStatus}
            </span>
            <span className={`rounded border px-2 py-0.5 text-xs ${statusTone(props.mission.status)}`}>
              {props.mission.status}
            </span>
          </div>
          <p className="mt-1 text-sm text-st-muted">{props.mission.description || "No description."}</p>
          <p className="mt-1 text-xs text-st-muted">
            Owner {props.mission.ownerLabel ?? props.mission.ownerUserId ?? "System"}
          </p>
          <p className="mt-1 text-xs text-st-muted">
            Updated {formatTimestamp(props.mission.updatedAt)} · Created {formatTimestamp(props.mission.createdAt)}
          </p>
          {props.mission.moderationHistory.length > 0 ? (
            <div className="mt-2 space-y-1 text-xs text-st-muted">
              <p className="font-medium text-st-fg">Recent moderation</p>
              {props.mission.moderationHistory.map((event, index) => (
                <div key={`${event.createdAt}-${index}`}>
                  <p>
                    {formatTimestamp(event.createdAt)} · {event.actorLabel ?? "Unknown admin"} · {event.summary}
                  </p>
                  {event.note !== null ? <p className="text-st-fg">Note: {event.note}</p> : null}
                </div>
              ))}
            </div>
          ) : null}
        </div>
        </div>
        <MissionSummary preview={props.mission.preview} />
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <label className="grid gap-1 text-xs text-st-muted">
          <span>Name</span>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            className="rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-fg outline-none focus:border-st-accent"
          />
        </label>
        <label className="grid gap-1 text-xs text-st-muted">
          <span>Map key</span>
          <input
            value={mapKey}
            onChange={(event) => setMapKey(event.target.value)}
            className="rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-fg outline-none focus:border-st-accent"
          />
        </label>
        <label className="grid gap-1 text-xs text-st-muted">
          <span>Level</span>
          <input
            type="number"
            min={1}
            step={1}
            value={level}
            onChange={(event) => setLevel(event.target.value)}
            className="rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-fg outline-none focus:border-st-accent"
          />
        </label>
        <label className="grid gap-1 text-xs text-st-muted">
          <span>Wins required</span>
          <input
            type="number"
            min={1}
            step={1}
            value={requiredWins}
            onChange={(event) => setRequiredWins(event.target.value)}
            className="rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-fg outline-none focus:border-st-accent"
          />
        </label>
        <label className="grid gap-1 text-xs text-st-muted">
          <span>Mode</span>
          <select
            value={mode}
            onChange={(event) => setMode(event.target.value as MissionRow["mode"])}
            className="rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-fg outline-none focus:border-st-accent"
          >
            <option value="conquest_core">conquest_core</option>
            <option value="conquest_plus">conquest_plus</option>
            <option value="trader_economy">trader_economy</option>
          </select>
        </label>
      </div>

      <label className="grid gap-1 text-xs text-st-muted">
        <span>Description</span>
        <input
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          className="rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-fg outline-none focus:border-st-accent"
        />
      </label>

      <div className="grid gap-3 md:grid-cols-4">
        <label className="grid gap-1 text-xs text-st-muted">
          <span>Source</span>
          <select
            value={source}
            disabled={readOnly}
            onChange={(event) => {
              const nextSource = event.target.value as MissionRow["source"];
              setSource(nextSource);
              if (nextSource === "official") {
                setReviewStatus("approved");
              }
            }}
            className="rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-fg outline-none focus:border-st-accent"
          >
            <option value="official">official</option>
            <option value="community">community</option>
          </select>
        </label>
        <label className="grid gap-1 text-xs text-st-muted">
          <span>Owner</span>
          <select
            value={source === "community" ? ownerUserId : ""}
            disabled={readOnly || source !== "community"}
            onChange={(event) => setOwnerUserId(event.target.value as Id<"users"> | "")}
            className="rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-fg outline-none focus:border-st-accent"
          >
            <option value="">System / unowned</option>
            {props.ownerOptions.map((owner) => (
              <option key={owner._id} value={owner._id}>
                {ownerOptionLabel(owner)}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-xs text-st-muted">
          <span>Review</span>
          <select
            value={source === "official" ? "approved" : reviewStatus}
            disabled={readOnly || source === "official"}
            onChange={(event) => setReviewStatus(event.target.value as MissionRow["reviewStatus"])}
            className="rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-fg outline-none focus:border-st-accent"
          >
            <option value="unreviewed">unreviewed</option>
            <option value="needs_changes">needs_changes</option>
            <option value="approved">approved</option>
          </select>
        </label>
        <label className="grid gap-1 text-xs text-st-muted">
          <span>Status</span>
          <select
            value={contentStatus}
            disabled={readOnly}
            onChange={(event) => setContentStatus(event.target.value as MissionRow["status"])}
            className="rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-fg outline-none focus:border-st-accent"
          >
            <option value="draft">draft</option>
            <option value="published">published</option>
            <option value="archived">archived</option>
            <option value="deleted">deleted</option>
            <option value="admin_deleted">admin_deleted</option>
          </select>
        </label>
      </div>

      <div className="grid gap-3 md:grid-cols-[2fr,140px,180px,160px]">
        <label className="grid gap-1 text-xs text-st-muted">
          <span>Prerequisite mission keys</span>
          <input
            value={prerequisitesText}
            onChange={(event) => setPrerequisitesText(event.target.value)}
            placeholder="starter-small-1, mission-2"
            className="rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-fg outline-none focus:border-st-accent"
          />
        </label>
        <label className="grid gap-1 text-xs text-st-muted">
          <span>Sort order</span>
          <input
            type="number"
            min={0}
            step={1}
            value={sortOrder}
            onChange={(event) => setSortOrder(event.target.value)}
            className="rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-fg outline-none focus:border-st-accent"
          />
        </label>
        <label className="grid gap-1 text-xs text-st-muted">
          <span>Retention class</span>
          <select
            value={retentionClass}
            onChange={(event) => setRetentionClass(event.target.value as MissionRow["retentionClass"])}
            className="rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-fg outline-none focus:border-st-accent"
          >
            <option value="official">official</option>
            <option value="archived_debug">archived_debug</option>
            <option value="discarded">discarded</option>
          </select>
        </label>
        <label className="grid gap-1 text-xs text-st-muted">
          <span>Required tier</span>
          <select
            value={requiredTier}
            onChange={(event) => setRequiredTier(event.target.value as MissionRow["requiredTier"])}
            className="rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-fg outline-none focus:border-st-accent"
          >
            <option value="free">free</option>
            <option value="pro">pro</option>
          </select>
        </label>
      </div>

      <p className="rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-muted">
        Player availability: <span className="font-medium text-st-fg">{contentStatus === "published" ? "Published" : "Not published"}</span>
      </p>

      <label className="grid gap-1 text-xs text-st-muted">
        <span>Scenario Builder</span>
        <MissionScenarioEditor
          scenarioJson={scenarioJson}
          onScenarioJsonChange={setScenarioJson}
          empireNpcs={props.empireNpcs}
          strategies={props.strategies}
        />
      </label>

      <label className="grid gap-1 text-xs text-st-muted">
        <span>Scenario JSON</span>
        <textarea
          value={scenarioJson}
          onChange={(event) => setScenarioJson(event.target.value)}
          rows={16}
          spellCheck={false}
          className="rounded border border-st-border bg-slate-950/60 px-3 py-2 font-mono text-xs text-st-fg outline-none focus:border-st-accent"
        />
      </label>

      <label className="grid gap-1 text-xs text-st-muted">
        <span>Moderation note (optional)</span>
        <ModerationNotePresets
          disabled={readOnly}
          onSelect={(preset) => setModerationNote((current) => applyModerationNotePreset(current, preset))}
        />
        <textarea
          value={moderationNote}
          disabled={readOnly}
          onChange={(event) => setModerationNote(event.target.value)}
          rows={3}
          placeholder="Why is this admin change being made?"
          className="rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-fg outline-none focus:border-st-accent"
        />
      </label>

      {status !== null ? <p className="text-sm text-emerald-300">{status}</p> : null}
      {error !== null ? <p className="text-sm text-red-300">{error}</p> : null}
      {readOnly ? <p className="text-sm text-st-muted">Terminal content stays visible here but can no longer be edited.</p> : null}

      <div className="flex justify-end">
        <Button type="button" onClick={() => void handleSave()} disabled={busy || readOnly}>
          {busy ? "Saving..." : "Save mission"}
        </Button>
      </div>
    </Card>
  );
}

function CreateMissionCard(props: {
  empireNpcs: EmpireNpcRow[];
  strategies: StrategyOption[];
  ownerOptions: AssignableOwnerRow[];
  onCreate: (args: {
    key: string;
    name: string;
    description: string;
    mapKey: string;
    ownerUserId: Id<"users"> | null;
    source: MissionRow["source"];
    reviewStatus: MissionRow["reviewStatus"];
    status: "draft" | "published";
    mode: MissionRow["mode"];
    requiredTier: MissionRow["requiredTier"];
    level: number;
    requiredWins: number;
    prerequisiteMissionKeys: string[];
    published: boolean;
    sortOrder: number;
    retentionClass: MissionRow["retentionClass"];
    scenarioJson: string;
  }) => Promise<void>;
}) {
  const [key, setKey] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [mapKey, setMapKey] = useState("v1-twenty");
  const [ownerUserId, setOwnerUserId] = useState<Id<"users"> | "">("");
  const [source, setSource] = useState<MissionRow["source"]>("official");
  const [reviewStatus, setReviewStatus] = useState<MissionRow["reviewStatus"]>("approved");
  const [contentStatus, setContentStatus] = useState<"draft" | "published">("published");
  const [mode, setMode] = useState<MissionRow["mode"]>("conquest_core");
  const [requiredTier, setRequiredTier] = useState<MissionRow["requiredTier"]>("free");
  const [level, setLevel] = useState("1");
  const [requiredWins, setRequiredWins] = useState("1");
  const [prerequisitesText, setPrerequisitesText] = useState("");
  const [sortOrder, setSortOrder] = useState("100");
  const [retentionClass, setRetentionClass] = useState<MissionRow["retentionClass"]>("official");
  const [scenarioJson, setScenarioJson] = useState(
    JSON.stringify(
      {
        playerEmpireKey: "aurora",
        npcEmpireKeys: [],
        automatedEmpireKeys: [],
        empireConfigs: [],
      },
      null,
      2,
    ),
  );
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setStatus(null);
    setError(null);
    try {
      await props.onCreate({
        key,
        name,
        description,
        mapKey,
        ownerUserId: source === "community" ? ownerUserId || null : null,
        source,
        reviewStatus: source === "official" ? "approved" : reviewStatus,
        status: contentStatus,
        mode,
        requiredTier,
        level: Number(level),
        requiredWins: Number(requiredWins),
        prerequisiteMissionKeys: parseCsv(prerequisitesText),
        published: contentStatus === "published",
        sortOrder: Number(sortOrder),
        retentionClass,
        scenarioJson,
      });
      setKey("");
      setName("");
      setDescription("");
      setMapKey("v1-twenty");
      setOwnerUserId("");
      setSource("official");
      setReviewStatus("approved");
      setContentStatus("published");
      setMode("conquest_core");
      setRequiredTier("free");
      setLevel("1");
      setRequiredWins("1");
      setPrerequisitesText("");
      setSortOrder("100");
      setRetentionClass("official");
      setScenarioJson(
        JSON.stringify(
          {
            playerEmpireKey: "aurora",
            npcEmpireKeys: [],
            automatedEmpireKeys: [],
            empireConfigs: [],
          },
          null,
          2,
        ),
      );
      setStatus("Created mission.");
    } catch (createError) {
      setError(mutationErrorMessage(createError));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="space-y-4">
      <div>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-st-muted">Create Mission</h2>
        <p className="mt-1 text-sm text-st-muted">
          Mission keys are stable slugs. Sequence progression with level, prerequisites, and required wins.
        </p>
      </div>

      <form className="space-y-4" onSubmit={(event) => void handleCreate(event)}>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <label className="grid gap-1 text-xs text-st-muted">
            <span>Key</span>
            <input
              value={key}
              onChange={(event) => setKey(event.target.value)}
              placeholder="mission-4"
              className="rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-fg outline-none focus:border-st-accent"
            />
          </label>
          <label className="grid gap-1 text-xs text-st-muted">
            <span>Name</span>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Encirclement"
              className="rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-fg outline-none focus:border-st-accent"
            />
          </label>
          <label className="grid gap-1 text-xs text-st-muted">
            <span>Map key</span>
            <input
              value={mapKey}
              onChange={(event) => setMapKey(event.target.value)}
              className="rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-fg outline-none focus:border-st-accent"
            />
          </label>
          <label className="grid gap-1 text-xs text-st-muted">
            <span>Level</span>
            <input
              type="number"
              min={1}
              step={1}
              value={level}
              onChange={(event) => setLevel(event.target.value)}
              className="rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-fg outline-none focus:border-st-accent"
            />
          </label>
          <label className="grid gap-1 text-xs text-st-muted">
            <span>Mode</span>
            <select
              value={mode}
              onChange={(event) => setMode(event.target.value as MissionRow["mode"])}
              className="rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-fg outline-none focus:border-st-accent"
            >
              <option value="conquest_core">conquest_core</option>
              <option value="conquest_plus">conquest_plus</option>
              <option value="trader_economy">trader_economy</option>
            </select>
          </label>
        </div>

        <div className="grid gap-3 md:grid-cols-4">
          <label className="grid gap-1 text-xs text-st-muted">
            <span>Source</span>
            <select
              value={source}
              onChange={(event) => {
                const nextSource = event.target.value as MissionRow["source"];
                setSource(nextSource);
                if (nextSource === "official") {
                  setReviewStatus("approved");
                }
              }}
              className="rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-fg outline-none focus:border-st-accent"
            >
              <option value="official">official</option>
              <option value="community">community</option>
            </select>
          </label>
          <label className="grid gap-1 text-xs text-st-muted">
            <span>Owner</span>
            <select
              value={source === "community" ? ownerUserId : ""}
              disabled={source !== "community"}
              onChange={(event) => setOwnerUserId(event.target.value as Id<"users"> | "")}
              className="rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-fg outline-none focus:border-st-accent"
            >
              <option value="">System / unowned</option>
              {props.ownerOptions.map((owner) => (
                <option key={owner._id} value={owner._id}>
                  {ownerOptionLabel(owner)}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-xs text-st-muted">
            <span>Review</span>
            <select
              value={source === "official" ? "approved" : reviewStatus}
              disabled={source === "official"}
              onChange={(event) => setReviewStatus(event.target.value as MissionRow["reviewStatus"])}
              className="rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-fg outline-none focus:border-st-accent"
            >
              <option value="unreviewed">unreviewed</option>
              <option value="needs_changes">needs_changes</option>
              <option value="approved">approved</option>
            </select>
          </label>
          <label className="grid gap-1 text-xs text-st-muted">
            <span>Status</span>
            <select
              value={contentStatus}
              onChange={(event) => setContentStatus(event.target.value as "draft" | "published")}
              className="rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-fg outline-none focus:border-st-accent"
            >
              <option value="draft">draft</option>
              <option value="published">published</option>
            </select>
          </label>
        </div>

        <label className="grid gap-1 text-xs text-st-muted">
          <span>Description</span>
          <input
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            className="rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-fg outline-none focus:border-st-accent"
          />
        </label>

        <div className="grid gap-3 md:grid-cols-[140px,180px,1fr,180px,160px]">
          <label className="grid gap-1 text-xs text-st-muted">
            <span>Wins required</span>
            <input
              type="number"
              min={1}
              step={1}
              value={requiredWins}
              onChange={(event) => setRequiredWins(event.target.value)}
              className="rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-fg outline-none focus:border-st-accent"
            />
          </label>
          <label className="grid gap-1 text-xs text-st-muted">
            <span>Sort order</span>
            <input
              type="number"
              min={0}
              step={1}
              value={sortOrder}
              onChange={(event) => setSortOrder(event.target.value)}
              className="rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-fg outline-none focus:border-st-accent"
            />
          </label>
          <label className="grid gap-1 text-xs text-st-muted">
            <span>Prerequisite mission keys</span>
            <input
              value={prerequisitesText}
              onChange={(event) => setPrerequisitesText(event.target.value)}
              placeholder="starter-small-1, mission-2"
              className="rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-fg outline-none focus:border-st-accent"
            />
          </label>
          <label className="grid gap-1 text-xs text-st-muted">
            <span>Retention class</span>
            <select
              value={retentionClass}
              onChange={(event) => setRetentionClass(event.target.value as MissionRow["retentionClass"])}
              className="rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-fg outline-none focus:border-st-accent"
            >
              <option value="official">official</option>
              <option value="archived_debug">archived_debug</option>
              <option value="discarded">discarded</option>
            </select>
          </label>
          <label className="grid gap-1 text-xs text-st-muted">
            <span>Required tier</span>
            <select
              value={requiredTier}
              onChange={(event) => setRequiredTier(event.target.value as MissionRow["requiredTier"])}
              className="rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-fg outline-none focus:border-st-accent"
            >
              <option value="free">free</option>
              <option value="pro">pro</option>
            </select>
          </label>
        </div>

        <p className="rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-muted">
          Player availability: <span className="font-medium text-st-fg">{contentStatus === "published" ? "Published" : "Not published"}</span>
        </p>

        <label className="grid gap-1 text-xs text-st-muted">
          <span>Scenario Builder</span>
          <MissionScenarioEditor
            scenarioJson={scenarioJson}
            onScenarioJsonChange={setScenarioJson}
            empireNpcs={props.empireNpcs}
            strategies={props.strategies}
          />
        </label>

        <label className="grid gap-1 text-xs text-st-muted">
          <span>Scenario JSON</span>
          <textarea
            value={scenarioJson}
            onChange={(event) => setScenarioJson(event.target.value)}
            rows={16}
            spellCheck={false}
            className="rounded border border-st-border bg-slate-950/60 px-3 py-2 font-mono text-xs text-st-fg outline-none focus:border-st-accent"
          />
        </label>

        {status !== null ? <p className="text-sm text-emerald-300">{status}</p> : null}
        {error !== null ? <p className="text-sm text-red-300">{error}</p> : null}

        <div className="flex justify-end">
          <Button type="submit" disabled={busy}>
            {busy ? "Creating..." : "Create mission"}
          </Button>
        </div>
      </form>
    </Card>
  );
}

export function AdminMissionsPage() {
  const [searchParams] = useSearchParams();
  const missionsQuery = useQuery(api.admin.queries.listMissions, {
    publishedOnly: false,
    fallbackToBuiltIns: false,
  });
  const usersQuery = useQuery(api.admin.queries.listUsers, { limit: 256 });
  const strategiesQuery = useQuery(api.admin.queries.listAutomationStrategies, {});
  const npcQuery = useQuery(api.admin.queries.listEmpireNpcPlayers, {
    includeInactive: false,
    fallbackToBuiltIns: false,
  });
  const createMission = useMutation(api.admin.mutations.createMission);
  const updateMission = useMutation(api.admin.mutations.updateMission);
  const bulkUpdateMissionStatus = useMutation(api.admin.mutations.bulkUpdateMissionStatus);
  const bulkUpdateMissionReviewStatus = useMutation(api.admin.mutations.bulkUpdateMissionReviewStatus);
  const bulkUpdateMissionOwner = useMutation(api.admin.mutations.bulkUpdateMissionOwner);
  const bulkUpdateMissionSource = useMutation(api.admin.mutations.bulkUpdateMissionSource);
  const seedMissingMissions = useMutation(api.admin.mutations.seedMissingMissions);
  const [seedBusy, setSeedBusy] = useState(false);
  const [seedStatus, setSeedStatus] = useState<string | null>(null);
  const [seedError, setSeedError] = useState<string | null>(null);
  const [searchText, setSearchText] = useState(() => searchParams.get("search") ?? "");
  const [sourceFilter, setSourceFilter] = useState<"all" | MissionRow["source"]>(() =>
    readMissionSourceFilter(searchParams.get("source")),
  );
  const [statusFilter, setStatusFilter] = useState<"all" | MissionRow["status"]>(() =>
    readMissionStatusFilter(searchParams.get("status")),
  );
  const [reviewFilter, setReviewFilter] = useState<"all" | MissionRow["reviewStatus"]>(() =>
    readMissionReviewFilter(searchParams.get("review")),
  );
  const [ownerFilter, setOwnerFilter] = useState<"all" | "system" | Id<"users">>(() =>
    readMissionOwnerFilter(searchParams.get("owner")),
  );
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [bulkStatus, setBulkStatus] = useState<MissionRow["status"]>("archived");
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkResult, setBulkResult] = useState<string | null>(null);
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [bulkReviewStatus, setBulkReviewStatus] = useState<MissionRow["reviewStatus"]>("approved");
  const [bulkReviewBusy, setBulkReviewBusy] = useState(false);
  const [bulkReviewResult, setBulkReviewResult] = useState<string | null>(null);
  const [bulkReviewError, setBulkReviewError] = useState<string | null>(null);
  const [bulkOwnerUserId, setBulkOwnerUserId] = useState<Id<"users"> | "">("");
  const [bulkOwnerBusy, setBulkOwnerBusy] = useState(false);
  const [bulkOwnerResult, setBulkOwnerResult] = useState<string | null>(null);
  const [bulkOwnerError, setBulkOwnerError] = useState<string | null>(null);
  const [bulkSource, setBulkSource] = useState<MissionRow["source"]>("community");
  const [bulkSourceBusy, setBulkSourceBusy] = useState(false);
  const [bulkSourceResult, setBulkSourceResult] = useState<string | null>(null);
  const [bulkSourceError, setBulkSourceError] = useState<string | null>(null);
  const [bulkModerationNote, setBulkModerationNote] = useState("");

  const missions = useMemo(
    () => (missionsQuery?.authorized ? (missionsQuery.missions as MissionRow[]) : []),
    [missionsQuery],
  );
  const deferredSearchText = useDeferredValue(searchText);
  const normalizedSearchText = normalizeSearchText(deferredSearchText);
  const selectedKeySet = useMemo(() => new Set(selectedKeys), [selectedKeys]);
  const strategies = useMemo(
    () =>
      strategiesQuery?.authorized
        ? ((strategiesQuery.strategies as StrategyOption[]).filter((strategy) => strategy.availableForNpcs))
        : [],
    [strategiesQuery],
  );
  const empireNpcs = useMemo(
    () => (npcQuery?.authorized ? (npcQuery.empireNpcs as EmpireNpcRow[]) : []),
    [npcQuery],
  );
  const ownerOptions = useMemo(
    () =>
      usersQuery?.authorized
        ? (usersQuery.users as AssignableOwnerRow[])
            .filter((user) => user.admin || user.publisher)
            .sort((left, right) => ownerOptionLabel(left).localeCompare(ownerOptionLabel(right)))
        : [],
    [usersQuery],
  );
  const filteredMissions = useMemo(
    () =>
      missions.filter((mission) => {
        if (sourceFilter !== "all" && mission.source !== sourceFilter) {
          return false;
        }
        if (statusFilter !== "all" && mission.status !== statusFilter) {
          return false;
        }
        if (reviewFilter !== "all" && mission.reviewStatus !== reviewFilter) {
          return false;
        }
        if (ownerFilter === "system" && mission.ownerUserId !== null) {
          return false;
        }
        if (ownerFilter !== "all" && ownerFilter !== "system" && mission.ownerUserId !== ownerFilter) {
          return false;
        }
        if (normalizedSearchText.length === 0) {
          return true;
        }
        return [
          mission.key,
          mission.name,
          mission.description,
          mission.mapKey,
          mission.ownerLabel ?? "",
          mission.mode,
          mission.requiredTier,
        ]
          .join(" ")
          .toLowerCase()
          .includes(normalizedSearchText);
      }),
    [missions, sourceFilter, statusFilter, reviewFilter, ownerFilter, normalizedSearchText],
  );
  const missionSummary = useMemo(
    () => ({
      official: missions.filter((mission) => mission.source === "official").length,
      community: missions.filter((mission) => mission.source === "community").length,
      unreviewed: missions.filter((mission) => mission.reviewStatus === "unreviewed").length,
      needsChanges: missions.filter((mission) => mission.reviewStatus === "needs_changes").length,
      approved: missions.filter((mission) => mission.reviewStatus === "approved").length,
      ownerlessCommunity: missions.filter(
        (mission) => mission.source === "community" && mission.ownerUserId === null,
      ).length,
      conquestCore: missions.filter((mission) => mission.mode === "conquest_core").length,
      traderEconomy: missions.filter((mission) => mission.mode === "trader_economy").length,
    }),
    [missions],
  );
  const visibleKeys = useMemo(() => filteredMissions.map((mission) => mission.key), [filteredMissions]);
  const selectedVisibleCount = useMemo(
    () => visibleKeys.filter((key) => selectedKeySet.has(key)).length,
    [visibleKeys, selectedKeySet],
  );
  const allVisibleSelected = visibleKeys.length > 0 && selectedVisibleCount === visibleKeys.length;

  function clearBulkFeedback() {
    setBulkResult(null);
    setBulkError(null);
    setBulkReviewResult(null);
    setBulkReviewError(null);
    setBulkOwnerResult(null);
    setBulkOwnerError(null);
    setBulkSourceResult(null);
    setBulkSourceError(null);
  }

  async function handleSeedBuiltIns() {
    setSeedBusy(true);
    setSeedStatus(null);
    setSeedError(null);
    try {
      const result = await seedMissingMissions({});
      setSeedStatus(`Seeded ${result.inserted} built-in missions. Skipped ${result.skipped}.`);
    } catch (error) {
      setSeedError(mutationErrorMessage(error));
    } finally {
      setSeedBusy(false);
    }
  }

  function toggleSelectedKey(key: string) {
    clearBulkFeedback();
    setSelectedKeys((current) => (current.includes(key) ? current.filter((value) => value !== key) : [...current, key]));
  }

  function toggleSelectVisible() {
    clearBulkFeedback();
    setSelectedKeys((current) => {
      const next = new Set(current);
      if (allVisibleSelected) {
        for (const key of visibleKeys) {
          next.delete(key);
        }
      } else {
        for (const key of visibleKeys) {
          next.add(key);
        }
      }
      return Array.from(next);
    });
  }

  async function handleBulkStatusUpdate() {
    clearBulkFeedback();
    if (selectedKeys.length === 0) {
      setBulkError("Select at least one mission first.");
      setBulkResult(null);
      return;
    }

    setBulkBusy(true);
    setBulkResult(null);
    setBulkError(null);
    try {
      const result = await bulkUpdateMissionStatus({
        keys: selectedKeys,
        status: bulkStatus,
        moderationNote: bulkModerationNote,
      });
      setBulkResult(`Updated ${result.updatedKeys.length} missions. Skipped ${result.skippedKeys.length}.`);
      setBulkModerationNote("");
      setSelectedKeys([]);
    } catch (error) {
      setBulkError(mutationErrorMessage(error));
    } finally {
      setBulkBusy(false);
    }
  }

  async function handleBulkOwnerUpdate() {
    clearBulkFeedback();
    if (selectedKeys.length === 0) {
      setBulkOwnerError("Select at least one mission first.");
      setBulkOwnerResult(null);
      return;
    }

    setBulkOwnerBusy(true);
    setBulkOwnerResult(null);
    setBulkOwnerError(null);
    try {
      const result = await bulkUpdateMissionOwner({
        keys: selectedKeys,
        ownerUserId: bulkOwnerUserId || null,
        moderationNote: bulkModerationNote,
      });
      setBulkOwnerResult(`Updated ${result.updatedKeys.length} mission owners. Skipped ${result.skippedKeys.length}.`);
      setBulkModerationNote("");
      setSelectedKeys([]);
    } catch (error) {
      setBulkOwnerError(mutationErrorMessage(error));
    } finally {
      setBulkOwnerBusy(false);
    }
  }

  async function handleBulkReviewUpdate() {
    clearBulkFeedback();
    if (selectedKeys.length === 0) {
      setBulkReviewError("Select at least one mission first.");
      setBulkReviewResult(null);
      return;
    }

    setBulkReviewBusy(true);
    setBulkReviewResult(null);
    setBulkReviewError(null);
    try {
      const result = await bulkUpdateMissionReviewStatus({
        keys: selectedKeys,
        reviewStatus: bulkReviewStatus,
        moderationNote: bulkModerationNote,
      });
      setBulkReviewResult(`Updated ${result.updatedKeys.length} mission review states. Skipped ${result.skippedKeys.length}.`);
      setBulkModerationNote("");
      setSelectedKeys([]);
    } catch (error) {
      setBulkReviewError(mutationErrorMessage(error));
    } finally {
      setBulkReviewBusy(false);
    }
  }

  async function handleBulkSourceUpdate() {
    clearBulkFeedback();
    if (selectedKeys.length === 0) {
      setBulkSourceError("Select at least one mission first.");
      setBulkSourceResult(null);
      return;
    }

    setBulkSourceBusy(true);
    setBulkSourceResult(null);
    setBulkSourceError(null);
    try {
      const result = await bulkUpdateMissionSource({
        keys: selectedKeys,
        source: bulkSource,
        moderationNote: bulkModerationNote,
      });
      setBulkSourceResult(`Updated ${result.updatedKeys.length} mission sources. Skipped ${result.skippedKeys.length}.`);
      setBulkModerationNote("");
      if (bulkSource === "official") {
        setBulkOwnerUserId("");
      }
      setSelectedKeys([]);
    } catch (error) {
      setBulkSourceError(mutationErrorMessage(error));
    } finally {
      setBulkSourceBusy(false);
    }
  }

  if (missionsQuery === undefined || usersQuery === undefined || strategiesQuery === undefined || npcQuery === undefined) {
    return (
      <div className="mx-auto max-w-[86.4rem] px-4 py-6">
        <Card className="text-sm text-st-muted">Loading missions...</Card>
      </div>
    );
  }

  if (!missionsQuery.authorized) {
    return (
      <div className="mx-auto max-w-[86.4rem] px-4 py-6">
        <Card className="text-sm text-st-muted">Sign in to manage missions.</Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[86.4rem] space-y-6 px-4 py-6">
      <Card className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-st-muted">Admin</p>
            <h1 className="text-2xl font-semibold text-st-fg">Missions</h1>
            <p className="mt-2 max-w-3xl text-sm text-st-muted">
              Edit the mission catalog that drives player progression. Each mission record controls map choice,
              sequencing, required wins, and scenario JSON for player empire, NPC strategy activation, and handicaps.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded border border-st-border px-3 py-2 text-xs text-st-muted">
              {filteredMissions.length} / {missions.length} missions
            </span>
            <Button type="button" variant="secondary" onClick={() => void handleSeedBuiltIns()} disabled={seedBusy}>
              {seedBusy ? "Seeding..." : "Seed built-ins"}
            </Button>
          </div>
        </div>
        <div className="grid gap-3 lg:grid-cols-[minmax(0,2fr)_repeat(4,minmax(0,1fr))]">
          <input
            value={searchText}
            onChange={(event) => setSearchText(event.target.value)}
            placeholder="Search key, name, description, map, owner, or mode"
            className="rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-fg"
          />
          <select
            value={sourceFilter}
            onChange={(event) => setSourceFilter(event.target.value as typeof sourceFilter)}
            className="rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-fg"
          >
            <option value="all">All sources</option>
            <option value="official">Official</option>
            <option value="community">Community</option>
          </select>
          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}
            className="rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-fg"
          >
            <option value="all">All statuses</option>
            <option value="draft">Draft</option>
            <option value="published">Published</option>
            <option value="archived">Archived</option>
            <option value="deleted">Deleted</option>
            <option value="admin_deleted">Admin deleted</option>
          </select>
          <select
            value={reviewFilter}
            onChange={(event) => setReviewFilter(event.target.value as typeof reviewFilter)}
            className="rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-fg"
          >
            <option value="all">All review states</option>
            <option value="unreviewed">Unreviewed</option>
            <option value="needs_changes">Needs changes</option>
            <option value="approved">Approved</option>
          </select>
          <select
            value={ownerFilter}
            onChange={(event) => setOwnerFilter(event.target.value as typeof ownerFilter)}
            className="rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-fg"
          >
            <option value="all">All owners</option>
            <option value="system">System / unowned</option>
            {ownerOptions.map((owner) => (
              <option key={owner._id} value={owner._id}>
                {ownerOptionLabel(owner)}
              </option>
            ))}
          </select>
        </div>
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          <div className="rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-muted">
            Official: <span className="font-medium text-st-fg">{missionSummary.official}</span>
          </div>
          <div className="rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-muted">
            Community: <span className="font-medium text-st-fg">{missionSummary.community}</span>
          </div>
          <div className="rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-muted">
            Needs review: <span className="font-medium text-st-fg">{missionSummary.unreviewed}</span>
          </div>
          <div className="rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-muted">
            Needs changes: <span className="font-medium text-st-fg">{missionSummary.needsChanges}</span>
          </div>
          <div className="rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-muted">
            Approved: <span className="font-medium text-st-fg">{missionSummary.approved}</span>
          </div>
          <div className="rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-muted">
            Ownerless community: <span className="font-medium text-st-fg">{missionSummary.ownerlessCommunity}</span>
          </div>
          <div className="rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-muted">
            Conquest core: <span className="font-medium text-st-fg">{missionSummary.conquestCore}</span>
          </div>
          <div className="rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-muted">
            Trader economy: <span className="font-medium text-st-fg">{missionSummary.traderEconomy}</span>
          </div>
        </div>
        <div className="space-y-3 rounded border border-st-border bg-st-bg/70 p-3">
          <div className="grid gap-3 lg:grid-cols-[minmax(0,1.3fr)_auto] lg:items-center">
            <p className="text-sm text-st-muted">
              {selectedVisibleCount} visible selected · {selectedKeys.length} total selected
            </p>
            <Button type="button" variant="secondary" onClick={toggleSelectVisible} disabled={visibleKeys.length === 0}>
              {allVisibleSelected ? "Clear visible" : "Select visible"}
            </Button>
          </div>

          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
            <div className="grid gap-3 lg:grid-cols-[180px_auto]">
              <select
                value={bulkStatus}
                onChange={(event) => setBulkStatus(event.target.value as MissionRow["status"])}
                className="rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-fg"
              >
                <option value="draft">Set to draft</option>
                <option value="published">Set to published</option>
                <option value="archived">Set to archived</option>
                <option value="deleted">Set to deleted</option>
                <option value="admin_deleted">Set to admin_deleted</option>
              </select>
              <Button type="button" onClick={() => void handleBulkStatusUpdate()} disabled={bulkBusy || selectedKeys.length === 0}>
                {bulkBusy ? "Applying..." : "Apply status"}
              </Button>
            </div>
            <p className="text-xs text-st-muted">Bulk lifecycle action</p>
          </div>

          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
            <div className="grid gap-3 lg:grid-cols-[180px_auto]">
              <select
                value={bulkReviewStatus}
                onChange={(event) => setBulkReviewStatus(event.target.value as MissionRow["reviewStatus"])}
                className="rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-fg"
              >
                <option value="unreviewed">Set review to unreviewed</option>
                <option value="needs_changes">Set review to needs_changes</option>
                <option value="approved">Set review to approved</option>
              </select>
              <Button type="button" onClick={() => void handleBulkReviewUpdate()} disabled={bulkReviewBusy || selectedKeys.length === 0}>
                {bulkReviewBusy ? "Applying..." : "Apply review"}
              </Button>
            </div>
            <p className="text-xs text-st-muted">Official rows only accept approved review state</p>
          </div>

          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
            <div className="grid gap-3 lg:grid-cols-[minmax(0,260px)_auto]">
              <select
                value={bulkOwnerUserId}
                onChange={(event) => setBulkOwnerUserId(event.target.value as Id<"users"> | "")}
                className="rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-fg"
              >
                <option value="">Set owner to System / unowned</option>
                {ownerOptions.map((owner) => (
                  <option key={owner._id} value={owner._id}>
                    {ownerOptionLabel(owner)}
                  </option>
                ))}
              </select>
              <Button type="button" onClick={() => void handleBulkOwnerUpdate()} disabled={bulkOwnerBusy || selectedKeys.length === 0}>
                {bulkOwnerBusy ? "Applying..." : "Apply owner"}
              </Button>
            </div>
            <p className="text-xs text-st-muted">Official rows skip non-empty owners automatically</p>
          </div>

          <label className="grid gap-1 text-xs text-st-muted">
            <span>Bulk moderation note (optional)</span>
            <ModerationNotePresets
              onSelect={(preset) => setBulkModerationNote((current) => applyModerationNotePreset(current, preset))}
            />
            <textarea
              value={bulkModerationNote}
              onChange={(event) => setBulkModerationNote(event.target.value)}
              rows={2}
              placeholder="Why is this batch change being made?"
              className="rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-fg"
            />
          </label>

          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
            <div className="grid gap-3 lg:grid-cols-[180px_auto]">
              <select
                value={bulkSource}
                onChange={(event) => setBulkSource(event.target.value as MissionRow["source"])}
                className="rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-fg"
              >
                <option value="community">Set source to community</option>
                <option value="official">Set source to official</option>
              </select>
              <Button type="button" onClick={() => void handleBulkSourceUpdate()} disabled={bulkSourceBusy || selectedKeys.length === 0}>
                {bulkSourceBusy ? "Applying..." : "Apply source"}
              </Button>
            </div>
            <p className="text-xs text-st-muted">Switching to official clears owners automatically</p>
          </div>
        </div>
        {bulkResult !== null ? <p className="text-sm text-emerald-300">{bulkResult}</p> : null}
        {bulkError !== null ? <p className="text-sm text-red-300">{bulkError}</p> : null}
        {bulkReviewResult !== null ? <p className="text-sm text-emerald-300">{bulkReviewResult}</p> : null}
        {bulkReviewError !== null ? <p className="text-sm text-red-300">{bulkReviewError}</p> : null}
        {bulkOwnerResult !== null ? <p className="text-sm text-emerald-300">{bulkOwnerResult}</p> : null}
        {bulkOwnerError !== null ? <p className="text-sm text-red-300">{bulkOwnerError}</p> : null}
        {bulkSourceResult !== null ? <p className="text-sm text-emerald-300">{bulkSourceResult}</p> : null}
        {bulkSourceError !== null ? <p className="text-sm text-red-300">{bulkSourceError}</p> : null}
        {seedStatus !== null ? <p className="text-sm text-emerald-300">{seedStatus}</p> : null}
        {seedError !== null ? <p className="text-sm text-red-300">{seedError}</p> : null}
      </Card>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr),320px]">
        <div className="space-y-4">
          <CreateMissionCard
            empireNpcs={empireNpcs}
            strategies={strategies}
            ownerOptions={ownerOptions}
            onCreate={async (args) => {
              await createMission(args);
            }}
          />
          {filteredMissions.length === 0 ? (
            <Card className="text-sm text-st-muted">
              No missions match the current filters.
            </Card>
          ) : (
            filteredMissions
              .slice()
              .sort((left, right) => left.sortOrder - right.sortOrder || left.name.localeCompare(right.name))
              .map((mission) => (
                <MissionCard
                  key={mission.key}
                  mission={mission}
                    selected={selectedKeySet.has(mission.key)}
                    onToggleSelect={toggleSelectedKey}
                  empireNpcs={empireNpcs}
                  strategies={strategies}
                  ownerOptions={ownerOptions}
                  onSave={async (args) => {
                    await updateMission(args);
                  }}
                />
              ))
          )}
        </div>

        <div className="space-y-4">
          <Card className="space-y-3">
            <div>
              <h2 className="text-sm font-semibold uppercase tracking-wide text-st-muted">Scenario Keys</h2>
              <p className="mt-1 text-sm text-st-muted">
                Use these saved keys inside mission scenario JSON when targeting NPC strategy or NPC empire overrides.
              </p>
            </div>
            <div className="space-y-3 text-xs text-st-muted">
              <div>
                <p className="font-semibold text-st-fg">NPC strategy keys</p>
                {strategies.length === 0 ? (
                  <p className="mt-1">No NPC-enabled strategies are available yet.</p>
                ) : (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {strategies.map((strategy) => (
                      <span key={strategy.key} className="rounded border border-st-border px-2 py-0.5">
                        {strategy.key}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <p className="font-semibold text-st-fg">Empire NPC keys</p>
                {empireNpcs.length === 0 ? (
                  <p className="mt-1">No empire NPCs are stored yet.</p>
                ) : (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {empireNpcs.map((npc) => (
                      <span key={npc.key} className="rounded border border-st-border px-2 py-0.5">
                        {npc.key}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </Card>

          <Card className="space-y-2 text-xs text-st-muted">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-st-muted">Scenario Notes</h2>
            <p>
              Set <span className="font-mono text-st-fg">playerEmpireKey</span> to the player-controlled empire.
            </p>
            <p>
              Use <span className="font-mono text-st-fg">npcEmpireKeys</span> to seed catalog NPC empires into the map.
            </p>
            <p>
              Use <span className="font-mono text-st-fg">automatedEmpireKeys</span> to turn seeded empires into NPC-controlled factions.
            </p>
            <p>
              Add entries to <span className="font-mono text-st-fg">empireConfigs</span> for strategy start delays, homeworld resource deltas, treasury changes, and display-name overrides.
            </p>
          </Card>
        </div>
      </div>
    </div>
  );
}