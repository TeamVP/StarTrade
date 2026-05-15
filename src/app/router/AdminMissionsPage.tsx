import { FormEvent, useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
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
  mapTier: "small" | "medium" | "large";
  level: number;
  requiredWins: number;
  prerequisiteMissionKeys: string[];
  published: boolean;
  sortOrder: number;
  retentionClass: "discarded" | "official" | "archived_debug";
  scenarioJson: string;
  preview: MissionPreview;
  createdAt: number;
  updatedAt: number;
};

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
        ...(existingIndex === -1 ? createEmptyConfig() : scenario.empireConfigs[existingIndex]!),
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
  empireNpcs: EmpireNpcRow[];
  strategies: StrategyOption[];
  onSave: (args: {
    key: string;
    name: string;
    description: string;
    mapKey: string;
    level: number;
    requiredWins: number;
    prerequisiteMissionKeys: string[];
    published: boolean;
    sortOrder: number;
    retentionClass: MissionRow["retentionClass"];
    scenarioJson: string;
  }) => Promise<void>;
}) {
  const [name, setName] = useState(props.mission.name);
  const [description, setDescription] = useState(props.mission.description);
  const [mapKey, setMapKey] = useState(props.mission.mapKey);
  const [level, setLevel] = useState(String(props.mission.level));
  const [requiredWins, setRequiredWins] = useState(String(props.mission.requiredWins));
  const [prerequisitesText, setPrerequisitesText] = useState(
    formatCsv(props.mission.prerequisiteMissionKeys),
  );
  const [published, setPublished] = useState(props.mission.published);
  const [sortOrder, setSortOrder] = useState(String(props.mission.sortOrder));
  const [retentionClass, setRetentionClass] = useState<MissionRow["retentionClass"]>(
    props.mission.retentionClass,
  );
  const [scenarioJson, setScenarioJson] = useState(props.mission.scenarioJson);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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
        level: Number(level),
        requiredWins: Number(requiredWins),
        prerequisiteMissionKeys: parseCsv(prerequisitesText),
        published,
        sortOrder: Number(sortOrder),
        retentionClass,
        scenarioJson,
      });
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
              {published ? "Published" : "Draft"}
            </span>
          </div>
          <p className="mt-1 text-sm text-st-muted">{props.mission.description || "No description."}</p>
          <p className="mt-1 text-xs text-st-muted">
            Updated {formatTimestamp(props.mission.updatedAt)} · Created {formatTimestamp(props.mission.createdAt)}
          </p>
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
      </div>

      <label className="grid gap-1 text-xs text-st-muted">
        <span>Description</span>
        <input
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          className="rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-fg outline-none focus:border-st-accent"
        />
      </label>

      <div className="grid gap-3 md:grid-cols-[2fr,140px,180px]">
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
      </div>

      <label className="flex items-center gap-2 rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-muted">
        <input
          type="checkbox"
          checked={published}
          onChange={(event) => setPublished(event.target.checked)}
          className="accent-cyan-400"
        />
        Published and available in player progression
      </label>

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
        <Button type="button" onClick={() => void handleSave()} disabled={busy}>
          {busy ? "Saving..." : "Save mission"}
        </Button>
      </div>
    </Card>
  );
}

function CreateMissionCard(props: {
  empireNpcs: EmpireNpcRow[];
  strategies: StrategyOption[];
  onCreate: (args: {
    key: string;
    name: string;
    description: string;
    mapKey: string;
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
  const [level, setLevel] = useState("1");
  const [requiredWins, setRequiredWins] = useState("1");
  const [prerequisitesText, setPrerequisitesText] = useState("");
  const [published, setPublished] = useState(true);
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
        level: Number(level),
        requiredWins: Number(requiredWins),
        prerequisiteMissionKeys: parseCsv(prerequisitesText),
        published,
        sortOrder: Number(sortOrder),
        retentionClass,
        scenarioJson,
      });
      setKey("");
      setName("");
      setDescription("");
      setMapKey("v1-twenty");
      setLevel("1");
      setRequiredWins("1");
      setPrerequisitesText("");
      setPublished(true);
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
        </div>

        <label className="grid gap-1 text-xs text-st-muted">
          <span>Description</span>
          <input
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            className="rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-fg outline-none focus:border-st-accent"
          />
        </label>

        <div className="grid gap-3 md:grid-cols-[140px,180px,1fr,180px]">
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
        </div>

        <label className="flex items-center gap-2 rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-muted">
          <input
            type="checkbox"
            checked={published}
            onChange={(event) => setPublished(event.target.checked)}
            className="accent-cyan-400"
          />
          Published and available to players
        </label>

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
  const missionsQuery = useQuery(api.admin.queries.listMissions, {
    publishedOnly: false,
    fallbackToBuiltIns: false,
  });
  const strategiesQuery = useQuery(api.admin.queries.listAutomationStrategies, {});
  const npcQuery = useQuery(api.admin.queries.listEmpireNpcPlayers, {
    includeInactive: false,
    fallbackToBuiltIns: false,
  });
  const createMission = useMutation(api.admin.mutations.createMission);
  const updateMission = useMutation(api.admin.mutations.updateMission);
  const seedMissingMissions = useMutation(api.admin.mutations.seedMissingMissions);
  const [seedBusy, setSeedBusy] = useState(false);
  const [seedStatus, setSeedStatus] = useState<string | null>(null);
  const [seedError, setSeedError] = useState<string | null>(null);

  const missions = missionsQuery?.authorized ? (missionsQuery.missions as MissionRow[]) : [];
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

  if (missionsQuery === undefined || strategiesQuery === undefined || npcQuery === undefined) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-6">
        <Card className="text-sm text-st-muted">Loading missions...</Card>
      </div>
    );
  }

  if (!missionsQuery.authorized) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-6">
        <Card className="text-sm text-st-muted">Sign in to manage missions.</Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-6">
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
              {missions.length} missions
            </span>
            <Button type="button" variant="secondary" onClick={() => void handleSeedBuiltIns()} disabled={seedBusy}>
              {seedBusy ? "Seeding..." : "Seed built-ins"}
            </Button>
          </div>
        </div>
        {seedStatus !== null ? <p className="text-sm text-emerald-300">{seedStatus}</p> : null}
        {seedError !== null ? <p className="text-sm text-red-300">{seedError}</p> : null}
      </Card>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr),320px]">
        <div className="space-y-4">
          <CreateMissionCard
            empireNpcs={empireNpcs}
            strategies={strategies}
            onCreate={async (args) => {
              await createMission(args);
            }}
          />
          {missions.length === 0 ? (
            <Card className="text-sm text-st-muted">
              No missions are stored yet. Seed the built-ins or create the first mission manually.
            </Card>
          ) : (
            missions
              .slice()
              .sort((left, right) => left.sortOrder - right.sortOrder || left.name.localeCompare(right.name))
              .map((mission) => (
                <MissionCard
                  key={mission.key}
                  mission={mission}
                  empireNpcs={empireNpcs}
                  strategies={strategies}
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