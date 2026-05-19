import { useMemo, useState } from "react";
import type { Id } from "../../../convex/_generated/dataModel";
import { Button } from "@/components/ui/button";

// ── Types ──────────────────────────────────────────────────────────────────

export type MissionPreview = {
  playerSlotKey: string | null;
  slotCount: number;
  npcControlledCount: number;
  delayedAutomationCount: number;
  handicapCount: number;
  fightAttractionCount: number;
  intruderDetectionCount: number;
};

export type MissionRow = {
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

export type AssignableOwnerRow = {
  _id: Id<"users">;
  name: string | null;
  email: string | null;
  admin: boolean;
  publisher: boolean;
};

export type StrategyOption = {
  key: string;
  name: string;
  availableForNpcs: boolean;
};

export type EmpireNpcRow = {
  key: string;
  playerName: string;
  empireName: string;
  isActive: boolean;
};

export type MissionSlotTrigger =
  | { kind: "turn"; turn: number }
  | { kind: "attacked" }
  | { kind: "intruder_detection"; routeSteps: number; requireNewEmpire: boolean };

export type MissionSlotOccupant =
  | { kind: "human" }
  | {
      kind: "npc";
      npcPlayerKey: string;
    };

export type MissionSlot = {
  slotKey: string;
  occupant: MissionSlotOccupant;
  automation: {
    strategyLibraryKey: string | null;
    activationTrigger: MissionSlotTrigger | null;
  };
  presentation: {
    factionLabelOverride: string | null;
    displayNameOverride: string | null;
  };
  resources: {
    treasuryDelta: number;
    homeworldPopulationDelta: number;
    homeworldStockFoodDelta: number;
    homeworldStockWeaponsDelta: number;
    homeworldStockResearchDelta: number;
    homeworldLocalTreasuryDelta: number;
  };
  sensors: {
    fightAttraction: number | null;
    intruderDetection: {
      routeSteps: number;
      requireNewEmpire: boolean;
    } | null;
  };
  startsHidden: boolean;
  revealTrigger: MissionSlotTrigger | null;
};

export type MissionScenario = {
  schemaVersion: 2;
  slots: MissionSlot[];
};

export type MissionScenarioWarning = {
  key: string;
  message: string;
  action:
    | { kind: "setHumanOccupant"; slotKey: string; label: string }
    | null;
};

// ── Helper functions ───────────────────────────────────────────────────────

export function ownerOptionLabel(owner: AssignableOwnerRow): string {
  return owner.name?.trim() || owner.email?.trim() || owner._id;
}

export function statusTone(status: MissionRow["status"]): string {
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

export function reviewTone(reviewStatus: MissionRow["reviewStatus"]): string {
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

export function mutationErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  return raw.replace(/^[\s\S]*?Error:\s*/g, "").trim() || "Something went wrong.";
}

export function formatTimestamp(value: number): string {
  if (value <= 0) {
    return "Built-in";
  }
  return new Date(value).toLocaleString();
}

export function parseCsv(text: string): string[] {
  return text
    .split(/[\n,]/)
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

export function formatCsv(values: string[]): string {
  return values.join(", ");
}

export const MODERATION_NOTE_PRESETS = [
  "Approved after moderation review.",
  "Needs changes before approval.",
  "Metadata normalized for catalog consistency.",
  "Ownership/source updated by admin moderation.",
] as const;

export function applyModerationNotePreset(currentNote: string, preset: string): string {
  const trimmed = currentNote.trim();
  if (trimmed.length === 0) {
    return preset;
  }
  if (trimmed.includes(preset)) {
    return currentNote;
  }
  return `${trimmed}\n${preset}`;
}

export function ModerationNotePresets(props: {
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

export function normalizeNullableString(value: string): string | null {
  const normalized = value.trim();
  return normalized.length === 0 ? null : normalized;
}

export function normalizeNullableInteger(value: string): number | null {
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

export function normalizeNullableNumber(value: string): number | null {
  const normalized = value.trim();
  if (normalized.length === 0) {
    return null;
  }
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

export function normalizeNumber(value: string): number {
  const normalized = value.trim();
  if (normalized.length === 0) {
    return 0;
  }
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function toMissionScenarioJson(scenario: MissionScenario): string {
  return JSON.stringify(
    {
      schemaVersion: scenario.schemaVersion,
      slots: scenario.slots.map((slot) => ({
        slotKey: slot.slotKey,
        occupant: slot.occupant,
        automation: slot.automation,
        presentation: slot.presentation,
        resources: slot.resources,
        sensors: slot.sensors,
        startsHidden: slot.startsHidden,
        revealTrigger: slot.revealTrigger,
      })),
    },
    null,
    2,
  );
}

export function normalizeTriggerKind(value: string): MissionSlotTrigger["kind"] | null {
  return value === "turn" || value === "attacked" || value === "intruder_detection"
    ? value
    : null;
}

export function createEmptyMissionSlot(slotKey = ""): MissionSlot {
  return {
    slotKey,
    occupant: { kind: "human" },
    automation: {
      strategyLibraryKey: null,
      activationTrigger: null,
    },
    presentation: {
      factionLabelOverride: null,
      displayNameOverride: null,
    },
    resources: {
      treasuryDelta: 0,
      homeworldPopulationDelta: 0,
      homeworldStockFoodDelta: 0,
      homeworldStockWeaponsDelta: 0,
      homeworldStockResearchDelta: 0,
      homeworldLocalTreasuryDelta: 0,
    },
    sensors: {
      fightAttraction: null,
      intruderDetection: null,
    },
    startsHidden: false,
    revealTrigger: null,
  };
}

export function nextAvailableSlotKey(base: string, slots: MissionSlot[]): string {
  const existing = new Set(slots.map((s) => s.slotKey));
  if (!existing.has(base)) return base;
  let n = 2;
  while (existing.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

type NpcPresetAction = "plain" | "delay_ai_start" | "light_handicap" | "fight_attraction" | "intruder_reveal";

function createNpcPresetSlot(args: {
  npcKey: string;
  presetType: "commander" | "seeded_rival";
  presetAction: NpcPresetAction;
  slots: MissionSlot[];
}): MissionSlot {
  const slotKey =
    args.presetType === "commander"
      ? nextAvailableSlotKey(args.npcKey, args.slots)
      : nextAvailableSlotKey(`rival-${args.npcKey}`, args.slots);

  const slot: MissionSlot = {
    ...createEmptyMissionSlot(slotKey),
    occupant: { kind: "npc", npcPlayerKey: args.npcKey },
  };

  switch (args.presetAction) {
    case "delay_ai_start":
      slot.automation.activationTrigger = { kind: "turn", turn: 2 };
      break;
    case "light_handicap":
      slot.resources = {
        treasuryDelta: -150,
        homeworldPopulationDelta: -5000000,
        homeworldStockFoodDelta: -400,
        homeworldStockWeaponsDelta: -20,
        homeworldStockResearchDelta: -10,
        homeworldLocalTreasuryDelta: -100,
      };
      break;
    case "fight_attraction":
      slot.sensors.fightAttraction = 3;
      break;
    case "intruder_reveal":
      slot.startsHidden = true;
      slot.sensors.intruderDetection = { routeSteps: 3, requireNewEmpire: true };
      slot.revealTrigger = { kind: "intruder_detection", routeSteps: 3, requireNewEmpire: true };
      break;
    case "plain":
    default:
      break;
  }

  return slot;
}

export function normalizeTrigger(input: unknown): MissionSlotTrigger | null {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return null;
  }
  const trigger = input as Record<string, unknown>;
  const kind = normalizeTriggerKind(typeof trigger.kind === "string" ? trigger.kind : "");
  if (kind === null) {
    return null;
  }
  if (kind === "attacked") {
    return { kind };
  }
  if (kind === "turn") {
    return {
      kind,
      turn:
        typeof trigger.turn === "number" && Number.isFinite(trigger.turn)
          ? Math.max(1, Math.floor(trigger.turn))
          : 1,
    };
  }
  return {
    kind,
    routeSteps:
      typeof trigger.routeSteps === "number" && Number.isFinite(trigger.routeSteps)
        ? Math.max(1, Math.floor(trigger.routeSteps))
        : 1,
    requireNewEmpire: trigger.requireNewEmpire !== false,
  };
}

export function parseMissionScenarioJson(text: string): { scenario: MissionScenario | null; error: string | null } {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return { scenario: null, error: "Scenario JSON cannot be empty." };
  }

  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    if (!Array.isArray(parsed.slots)) {
      return {
        scenario: null,
        error: "Scenario JSON must use schemaVersion 2 with a slots array.",
      };
    }

    const legacyOwnerSlotKey =
      typeof parsed.ownerSlotKey === "string" && parsed.ownerSlotKey.trim().length > 0
        ? parsed.ownerSlotKey.trim()
        : null;

    let slots = parsed.slots.map((value) => {
      const row = (value ?? {}) as Record<string, unknown>;
      const occupant =
        typeof row.occupant === "object" && row.occupant !== null && !Array.isArray(row.occupant)
          ? (row.occupant as Record<string, unknown>)
          : null;
      const automation =
        typeof row.automation === "object" && row.automation !== null && !Array.isArray(row.automation)
          ? (row.automation as Record<string, unknown>)
          : {};
      const presentation =
        typeof row.presentation === "object" && row.presentation !== null && !Array.isArray(row.presentation)
          ? (row.presentation as Record<string, unknown>)
          : {};
      const resources =
        typeof row.resources === "object" && row.resources !== null && !Array.isArray(row.resources)
          ? (row.resources as Record<string, unknown>)
          : row;
      const sensors =
        typeof row.sensors === "object" && row.sensors !== null && !Array.isArray(row.sensors)
          ? (row.sensors as Record<string, unknown>)
          : {};
      const intruderDetection =
        typeof sensors.intruderDetection === "object" &&
        sensors.intruderDetection !== null &&
        !Array.isArray(sensors.intruderDetection)
          ? (sensors.intruderDetection as Record<string, unknown>)
          : null;
      return {
        slotKey:
          typeof row.slotKey === "string" && row.slotKey.trim().length > 0
            ? row.slotKey.trim()
            : "",
        occupant:
          occupant?.kind === "npc" &&
          typeof occupant.npcPlayerKey === "string" &&
          occupant.npcPlayerKey.trim().length > 0
            ? { kind: "npc", npcPlayerKey: occupant.npcPlayerKey.trim() }
            : { kind: "human" },
        automation: {
          strategyLibraryKey:
            typeof automation.strategyLibraryKey === "string" &&
            automation.strategyLibraryKey.trim().length > 0
              ? automation.strategyLibraryKey.trim()
              : null,
          activationTrigger: normalizeTrigger(automation.activationTrigger),
        },
        presentation: {
          factionLabelOverride:
            typeof presentation.factionLabelOverride === "string" &&
            presentation.factionLabelOverride.trim().length > 0
              ? presentation.factionLabelOverride.trim()
              : null,
          displayNameOverride:
            typeof presentation.displayNameOverride === "string" &&
            presentation.displayNameOverride.trim().length > 0
              ? presentation.displayNameOverride.trim()
              : null,
        },
        resources: {
          treasuryDelta:
            typeof resources.treasuryDelta === "number" && Number.isFinite(resources.treasuryDelta)
              ? resources.treasuryDelta
              : 0,
          homeworldPopulationDelta:
            typeof resources.homeworldPopulationDelta === "number" && Number.isFinite(resources.homeworldPopulationDelta)
              ? resources.homeworldPopulationDelta
              : 0,
          homeworldStockFoodDelta:
            typeof resources.homeworldStockFoodDelta === "number" && Number.isFinite(resources.homeworldStockFoodDelta)
              ? resources.homeworldStockFoodDelta
              : 0,
          homeworldStockWeaponsDelta:
            typeof resources.homeworldStockWeaponsDelta === "number" && Number.isFinite(resources.homeworldStockWeaponsDelta)
              ? resources.homeworldStockWeaponsDelta
              : 0,
          homeworldStockResearchDelta:
            typeof resources.homeworldStockResearchDelta === "number" && Number.isFinite(resources.homeworldStockResearchDelta)
              ? resources.homeworldStockResearchDelta
              : 0,
          homeworldLocalTreasuryDelta:
            typeof resources.homeworldLocalTreasuryDelta === "number" && Number.isFinite(resources.homeworldLocalTreasuryDelta)
              ? resources.homeworldLocalTreasuryDelta
              : 0,
        },
        sensors: {
          fightAttraction:
            typeof sensors.fightAttraction === "number" && Number.isFinite(sensors.fightAttraction)
              ? sensors.fightAttraction
              : null,
          intruderDetection:
            intruderDetection === null
              ? null
              : {
                  routeSteps:
                    typeof intruderDetection.routeSteps === "number" && Number.isFinite(intruderDetection.routeSteps)
                      ? Math.max(1, Math.floor(intruderDetection.routeSteps))
                      : 1,
                  requireNewEmpire: intruderDetection.requireNewEmpire !== false,
                },
        },
        startsHidden: row.startsHidden === true,
        revealTrigger: normalizeTrigger(row.revealTrigger),
      } satisfies MissionSlot;
    });

    if (
      legacyOwnerSlotKey !== null &&
      slots.filter((slot) => slot.occupant.kind === "human").length === 0
    ) {
      slots = slots.map((slot) =>
        slot.slotKey === legacyOwnerSlotKey ? { ...slot, occupant: { kind: "human" } } : slot,
      );
    }

    const scenario: MissionScenario = {
      schemaVersion: 2,
      slots,
    };
    return { scenario, error: null };
  } catch (error) {
    return {
      scenario: null,
      error: error instanceof Error ? error.message : "Scenario JSON must be valid JSON.",
    };
  }
}

export function hasMissionHandicap(slot: MissionSlot): boolean {
  return (
    slot.resources.treasuryDelta !== 0 ||
    slot.resources.homeworldPopulationDelta !== 0 ||
    slot.resources.homeworldStockFoodDelta !== 0 ||
    slot.resources.homeworldStockWeaponsDelta !== 0 ||
    slot.resources.homeworldStockResearchDelta !== 0 ||
    slot.resources.homeworldLocalTreasuryDelta !== 0
  );
}

export function describeMissionSlotOccupantDefaults(slot: MissionSlot, empireNpcs: EmpireNpcRow[]): string {
  if (slot.occupant.kind !== "npc") {
    return "Uses player profile and empire preferences";
  }
  const npcPlayerKey = slot.occupant.npcPlayerKey;
  return (
    empireNpcs.find((npc) => npc.key === npcPlayerKey)?.empireName ??
    npcPlayerKey
  );
}

export function collectMissionScenarioWarnings(scenario: MissionScenario): MissionScenarioWarning[] {
  const warnings: MissionScenarioWarning[] = [];
  const duplicateSlotKeys = new Set<string>();
  const seenSlotKeys = new Set<string>();
  const humanSlots = scenario.slots.filter((slot) => slot.occupant.kind === "human");

  for (const slot of scenario.slots) {
    const slotKey = slot.slotKey.trim();
    if (slotKey.length > 0) {
      if (seenSlotKeys.has(slotKey)) {
        duplicateSlotKeys.add(slotKey);
      }
      seenSlotKeys.add(slotKey);
    } else {
      warnings.push({
        key: `empty-slot-${warnings.length}`,
        message: "A slot row has no slot key.",
        action: null,
      });
    }

  }

  if (humanSlots.length === 0) {
    warnings.push({
      key: "missing-human-slot",
      message: "Mission must contain exactly one human player slot.",
      action:
        scenario.slots[0] === undefined
          ? null
          : {
              kind: "setHumanOccupant",
              slotKey: scenario.slots[0].slotKey,
              label: "Make first slot human",
            },
    });
  } else if (humanSlots.length > 1) {
    warnings.push({
      key: "multiple-human-slots",
      message: `Mission must contain exactly one human player slot. Found ${humanSlots.length}.`,
      action: null,
    });
  }

  for (const slotKey of duplicateSlotKeys) {
    warnings.push({
      key: `duplicate-slot-${slotKey}`,
      message: `Multiple slot rows target the same slot key: ${slotKey}.`,
      action: null,
    });
  }

  return warnings;
}

// ── Components ─────────────────────────────────────────────────────────────

type SlotModalState =
  | { kind: "closed" }
  | { kind: "create" }
  | { kind: "edit"; slotIndex: number };

function SlotModal(props: {
  initialSlot: MissionSlot;
  isCreate: boolean;
  empireNpcs: EmpireNpcRow[];
  strategies: StrategyOption[];
  onSave: (slot: MissionSlot) => void;
  onDelete?: () => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<MissionSlot>(props.initialSlot);

  function update(updater: (slot: MissionSlot) => MissionSlot) {
    setDraft((prev) => updater(prev));
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) props.onClose();
      }}
    >
      <div className="my-8 w-full max-w-2xl rounded-lg border border-st-border bg-st-bg shadow-xl">
        {/* Header */}
        <div className="border-b border-st-border px-6 py-4">
          <h3 className="text-sm font-semibold text-st-fg">
            {props.isCreate ? "Create slot" : `Edit slot: ${draft.slotKey || "(unnamed)"}`}
          </h3>
        </div>

        {/* Body */}
        <div className="space-y-5 px-6 py-5">
          {/* Player ownership */}
          <div className="flex items-center justify-between gap-3 rounded border border-st-border bg-st-panel px-3 py-3">
            <div>
              <div className="text-xs font-medium text-st-fg">Player ownership</div>
              <div className="mt-0.5 text-xs text-st-muted">
                {draft.occupant.kind === "human"
                  ? "This slot is designated as the human player's empire."
                  : "Designate this slot as the human player's empire."}
              </div>
            </div>
            {draft.occupant.kind === "human" ? (
              <span className="shrink-0 rounded bg-st-accent/20 px-2 py-0.5 text-xs font-medium text-st-accent">
                Player slot
              </span>
            ) : (
              <button
                type="button"
                onClick={() => {
                  update((s) => ({
                    ...s,
                    occupant: { kind: "human" },
                    startsHidden: false,
                    revealTrigger: null,
                  }));
                }}
                className="shrink-0 rounded border border-st-border px-3 py-1.5 text-xs text-st-fg hover:border-st-accent hover:text-st-accent"
              >
                Make human player
              </button>
            )}
          </div>

          {/* Identity */}
          <div className="grid gap-3 md:grid-cols-2">
            <label className="grid gap-1 text-xs text-st-muted">
              <span>Slot key</span>
              <input
                value={draft.slotKey}
                onChange={(e) => update((s) => ({ ...s, slotKey: e.target.value.trim() }))}
                placeholder="aurora"
                className="rounded border border-st-border bg-st-panel px-3 py-2 text-sm text-st-fg outline-none focus:border-st-accent"
              />
            </label>
          </div>

          {/* Occupant */}
          <div className="space-y-2">
            <p className="text-xs font-medium uppercase tracking-wide text-st-muted">Occupant</p>
            <div className="grid gap-3 md:grid-cols-2">
              <label className="grid gap-1 text-xs text-st-muted">
                <span>Occupant type</span>
                <select
                  value={draft.occupant.kind}
                  onChange={(e) => {
                    const value = e.target.value;
                    update((s) => ({
                      ...s,
                      occupant:
                        value === "npc"
                          ? {
                              kind: "npc",
                              npcPlayerKey:
                                s.occupant.kind === "npc"
                                  ? s.occupant.npcPlayerKey
                                  : props.empireNpcs[0]?.key ?? "",
                            }
                          : { kind: "human" },
                    }));
                  }}
                  className="rounded border border-st-border bg-st-panel px-3 py-2 text-sm text-st-fg outline-none focus:border-st-accent"
                >
                  <option value="human">human</option>
                  <option value="npc">npc</option>
                </select>
              </label>
              <label className="grid gap-1 text-xs text-st-muted">
                <span>NPC profile</span>
                <select
                  value={draft.occupant.kind === "npc" ? draft.occupant.npcPlayerKey : ""}
                  disabled={draft.occupant.kind !== "npc"}
                  onChange={(e) => {
                    update((s) => ({
                      ...s,
                      occupant:
                        s.occupant.kind === "npc"
                          ? {
                              kind: "npc",
                              npcPlayerKey:
                                normalizeNullableString(e.target.value) ?? s.occupant.npcPlayerKey,
                            }
                          : s.occupant,
                    }));
                  }}
                  className="rounded border border-st-border bg-st-panel px-3 py-2 text-sm text-st-fg outline-none focus:border-st-accent disabled:opacity-60"
                >
                  <option value="">Select NPC</option>
                  {props.empireNpcs.map((npc) => (
                    <option key={npc.key} value={npc.key}>
                      {npc.playerName} ({npc.key})
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>

          {/* Automation */}
          <div className="space-y-2">
            <p className="text-xs font-medium uppercase tracking-wide text-st-muted">Automation</p>
            <div className="grid gap-3 md:grid-cols-2">
              <label className="grid gap-1 text-xs text-st-muted">
                <span>Strategy</span>
                <select
                  value={draft.automation.strategyLibraryKey ?? ""}
                  onChange={(e) => {
                    update((s) => ({
                      ...s,
                      automation: {
                        ...s.automation,
                        strategyLibraryKey: normalizeNullableString(e.target.value),
                      },
                    }));
                  }}
                  className="rounded border border-st-border bg-st-panel px-3 py-2 text-sm text-st-fg outline-none focus:border-st-accent"
                >
                  <option value="">Use default</option>
                  {props.strategies.map((strategy) => (
                    <option key={strategy.key} value={strategy.key}>
                      {strategy.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1 text-xs text-st-muted">
                <span>Activation trigger</span>
                <select
                  value={draft.automation.activationTrigger?.kind ?? ""}
                  onChange={(e) => {
                    const kind = normalizeTriggerKind(e.target.value);
                    update((s) => ({
                      ...s,
                      automation: {
                        ...s.automation,
                        activationTrigger:
                          kind === null
                            ? null
                            : kind === "attacked"
                              ? { kind }
                              : kind === "turn"
                                ? { kind, turn: 2 }
                                : { kind, routeSteps: 3, requireNewEmpire: true },
                      },
                    }));
                  }}
                  className="rounded border border-st-border bg-st-panel px-3 py-2 text-sm text-st-fg outline-none focus:border-st-accent"
                >
                  <option value="">No trigger</option>
                  <option value="turn">turn</option>
                  <option value="attacked">attacked</option>
                  <option value="intruder_detection">intruder_detection</option>
                </select>
              </label>
              {(draft.automation.activationTrigger?.kind === "turn" ||
                draft.automation.activationTrigger?.kind === "intruder_detection") && (
                <label className="grid gap-1 text-xs text-st-muted">
                  <span>Trigger turn / steps</span>
                  <input
                    type="number"
                    min={1}
                    step={1}
                    value={
                      draft.automation.activationTrigger.kind === "turn"
                        ? draft.automation.activationTrigger.turn
                        : draft.automation.activationTrigger.routeSteps
                    }
                    onChange={(e) => {
                      const value = normalizeNullableInteger(e.target.value) ?? 1;
                      update((s) => {
                        const trigger = s.automation.activationTrigger;
                        if (trigger?.kind === "turn") {
                          return {
                            ...s,
                            automation: {
                              ...s.automation,
                              activationTrigger: { kind: "turn", turn: value },
                            },
                          };
                        }
                        if (trigger?.kind === "intruder_detection") {
                          return {
                            ...s,
                            automation: {
                              ...s.automation,
                              activationTrigger: { ...trigger, routeSteps: value },
                            },
                          };
                        }
                        return s;
                      });
                    }}
                    className="rounded border border-st-border bg-st-panel px-3 py-2 text-sm text-st-fg outline-none focus:border-st-accent"
                  />
                </label>
              )}
              {draft.automation.activationTrigger?.kind === "intruder_detection" && (
                <label className="grid gap-1 text-xs text-st-muted">
                  <span>Trigger new empire only</span>
                  <select
                    value={draft.automation.activationTrigger.requireNewEmpire ? "yes" : "no"}
                    onChange={(e) => {
                      update((s) => {
                        const trigger = s.automation.activationTrigger;
                        if (trigger?.kind !== "intruder_detection") return s;
                        return {
                          ...s,
                          automation: {
                            ...s.automation,
                            activationTrigger: {
                              ...trigger,
                              requireNewEmpire: e.target.value !== "no",
                            },
                          },
                        };
                      });
                    }}
                    className="rounded border border-st-border bg-st-panel px-3 py-2 text-sm text-st-fg outline-none focus:border-st-accent"
                  >
                    <option value="yes">yes</option>
                    <option value="no">no</option>
                  </select>
                </label>
              )}
            </div>
          </div>

          {/* Visibility */}
          <div className="space-y-2">
            <p className="text-xs font-medium uppercase tracking-wide text-st-muted">Visibility</p>
            <p className="text-xs text-st-muted">
              Hidden NPC slots stay dormant until their reveal trigger fires. Turn reveal is time-based,
              attacked reveal fires when one of their systems is threatened, and intruder detection reveal
              fires when hostile fleets are spotted within the configured route depth.
            </p>
            <div className="grid gap-3 md:grid-cols-2">
              <label className="grid gap-1 text-xs text-st-muted">
                <span>Starts hidden</span>
                <select
                  value={draft.startsHidden ? "yes" : "no"}
                  onChange={(e) => update((s) => ({ ...s, startsHidden: e.target.value === "yes" }))}
                  className="rounded border border-st-border bg-st-panel px-3 py-2 text-sm text-st-fg outline-none focus:border-st-accent"
                >
                  <option value="no">no</option>
                  <option value="yes">yes</option>
                </select>
              </label>
              <label className="grid gap-1 text-xs text-st-muted">
                <span>Reveal trigger</span>
                <select
                  value={draft.revealTrigger?.kind ?? ""}
                  onChange={(e) => {
                    const kind = normalizeTriggerKind(e.target.value);
                    update((s) => ({
                      ...s,
                      revealTrigger:
                        kind === null
                          ? null
                          : kind === "attacked"
                            ? { kind }
                            : kind === "turn"
                              ? { kind, turn: 2 }
                              : { kind, routeSteps: 3, requireNewEmpire: true },
                    }));
                  }}
                  className="rounded border border-st-border bg-st-panel px-3 py-2 text-sm text-st-fg outline-none focus:border-st-accent"
                >
                  <option value="">No reveal trigger</option>
                  <option value="turn">turn</option>
                  <option value="attacked">attacked</option>
                  <option value="intruder_detection">intruder_detection</option>
                </select>
              </label>
            </div>
          </div>

          {/* Sensors */}
          <div className="space-y-2">
            <p className="text-xs font-medium uppercase tracking-wide text-st-muted">Sensors</p>
            <p className="text-xs text-st-muted">
              Intruder detection expands defensive awareness beyond owned systems. Fight attraction makes
              the slot commit more ships and accept lower attack-advantage margins near contested fronts.
            </p>
            <div className="grid gap-3 md:grid-cols-2">
              <label className="grid gap-1 text-xs text-st-muted">
                <span>Fight attraction</span>
                <input
                  type="number"
                  step={0.1}
                  value={draft.sensors.fightAttraction ?? ""}
                  onChange={(e) => {
                    update((s) => ({
                      ...s,
                      sensors: {
                        ...s.sensors,
                        fightAttraction: normalizeNullableNumber(e.target.value),
                      },
                    }));
                  }}
                  className="rounded border border-st-border bg-st-panel px-3 py-2 text-sm text-st-fg outline-none focus:border-st-accent"
                />
              </label>
              <label className="grid gap-1 text-xs text-st-muted">
                <span>Intruder detection steps</span>
                <input
                  type="number"
                  step={1}
                  min={1}
                  value={draft.sensors.intruderDetection?.routeSteps ?? ""}
                  onChange={(e) => {
                    const value = normalizeNullableInteger(e.target.value);
                    update((s) => ({
                      ...s,
                      sensors: {
                        ...s.sensors,
                        intruderDetection:
                          value === null
                            ? null
                            : {
                                routeSteps: value,
                                requireNewEmpire:
                                  s.sensors.intruderDetection?.requireNewEmpire ?? true,
                              },
                      },
                    }));
                  }}
                  className="rounded border border-st-border bg-st-panel px-3 py-2 text-sm text-st-fg outline-none focus:border-st-accent"
                />
              </label>
              {draft.sensors.intruderDetection !== null && (
                <label className="grid gap-1 text-xs text-st-muted">
                  <span>Intruder new empire only</span>
                  <select
                    value={draft.sensors.intruderDetection.requireNewEmpire ? "yes" : "no"}
                    onChange={(e) => {
                      update((s) => ({
                        ...s,
                        sensors: {
                          ...s.sensors,
                          intruderDetection:
                            s.sensors.intruderDetection === null
                              ? null
                              : {
                                  ...s.sensors.intruderDetection,
                                  requireNewEmpire: e.target.value !== "no",
                                },
                        },
                      }));
                    }}
                    className="rounded border border-st-border bg-st-panel px-3 py-2 text-sm text-st-fg outline-none focus:border-st-accent"
                  >
                    <option value="yes">yes</option>
                    <option value="no">no</option>
                  </select>
                </label>
              )}
            </div>
          </div>

          {/* Presentation */}
          <div className="space-y-2">
            <p className="text-xs font-medium uppercase tracking-wide text-st-muted">Presentation</p>
            <div className="grid gap-3 md:grid-cols-2">
              <label className="grid gap-1 text-xs text-st-muted">
                <span>Faction label override</span>
                <input
                  value={draft.presentation.factionLabelOverride ?? ""}
                  onChange={(e) => {
                    update((s) => ({
                      ...s,
                      presentation: {
                        ...s.presentation,
                        factionLabelOverride: normalizeNullableString(e.target.value),
                      },
                    }));
                  }}
                  className="rounded border border-st-border bg-st-panel px-3 py-2 text-sm text-st-fg outline-none focus:border-st-accent"
                />
              </label>
              <label className="grid gap-1 text-xs text-st-muted">
                <span>Display name override</span>
                <input
                  value={draft.presentation.displayNameOverride ?? ""}
                  onChange={(e) => {
                    update((s) => ({
                      ...s,
                      presentation: {
                        ...s.presentation,
                        displayNameOverride: normalizeNullableString(e.target.value),
                      },
                    }));
                  }}
                  className="rounded border border-st-border bg-st-panel px-3 py-2 text-sm text-st-fg outline-none focus:border-st-accent"
                />
              </label>
            </div>
          </div>

          {/* Resources */}
          <div className="space-y-2">
            <p className="text-xs font-medium uppercase tracking-wide text-st-muted">Resource handicaps</p>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              <label className="grid gap-1 text-xs text-st-muted">
                <span>Treasury delta</span>
                <input
                  type="number"
                  step={1}
                  value={draft.resources.treasuryDelta}
                  onChange={(e) =>
                    update((s) => ({
                      ...s,
                      resources: { ...s.resources, treasuryDelta: normalizeNumber(e.target.value) },
                    }))
                  }
                  className="rounded border border-st-border bg-st-panel px-3 py-2 text-sm text-st-fg outline-none focus:border-st-accent"
                />
              </label>
              <label className="grid gap-1 text-xs text-st-muted">
                <span>Population delta</span>
                <input
                  type="number"
                  step={1}
                  value={draft.resources.homeworldPopulationDelta}
                  onChange={(e) =>
                    update((s) => ({
                      ...s,
                      resources: {
                        ...s.resources,
                        homeworldPopulationDelta: normalizeNumber(e.target.value),
                      },
                    }))
                  }
                  className="rounded border border-st-border bg-st-panel px-3 py-2 text-sm text-st-fg outline-none focus:border-st-accent"
                />
              </label>
              <label className="grid gap-1 text-xs text-st-muted">
                <span>Food delta</span>
                <input
                  type="number"
                  step={1}
                  value={draft.resources.homeworldStockFoodDelta}
                  onChange={(e) =>
                    update((s) => ({
                      ...s,
                      resources: {
                        ...s.resources,
                        homeworldStockFoodDelta: normalizeNumber(e.target.value),
                      },
                    }))
                  }
                  className="rounded border border-st-border bg-st-panel px-3 py-2 text-sm text-st-fg outline-none focus:border-st-accent"
                />
              </label>
              <label className="grid gap-1 text-xs text-st-muted">
                <span>Weapons delta</span>
                <input
                  type="number"
                  step={1}
                  value={draft.resources.homeworldStockWeaponsDelta}
                  onChange={(e) =>
                    update((s) => ({
                      ...s,
                      resources: {
                        ...s.resources,
                        homeworldStockWeaponsDelta: normalizeNumber(e.target.value),
                      },
                    }))
                  }
                  className="rounded border border-st-border bg-st-panel px-3 py-2 text-sm text-st-fg outline-none focus:border-st-accent"
                />
              </label>
              <label className="grid gap-1 text-xs text-st-muted">
                <span>Research delta</span>
                <input
                  type="number"
                  step={1}
                  value={draft.resources.homeworldStockResearchDelta}
                  onChange={(e) =>
                    update((s) => ({
                      ...s,
                      resources: {
                        ...s.resources,
                        homeworldStockResearchDelta: normalizeNumber(e.target.value),
                      },
                    }))
                  }
                  className="rounded border border-st-border bg-st-panel px-3 py-2 text-sm text-st-fg outline-none focus:border-st-accent"
                />
              </label>
              <label className="grid gap-1 text-xs text-st-muted">
                <span>Local treasury delta</span>
                <input
                  type="number"
                  step={1}
                  value={draft.resources.homeworldLocalTreasuryDelta}
                  onChange={(e) =>
                    update((s) => ({
                      ...s,
                      resources: {
                        ...s.resources,
                        homeworldLocalTreasuryDelta: normalizeNumber(e.target.value),
                      },
                    }))
                  }
                  className="rounded border border-st-border bg-st-panel px-3 py-2 text-sm text-st-fg outline-none focus:border-st-accent"
                />
              </label>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 border-t border-st-border px-6 py-4">
          <div>
            {!props.isCreate && props.onDelete ? (
              <button
                type="button"
                onClick={props.onDelete}
                title="Delete slot"
                className="flex h-8 w-8 items-center justify-center rounded border border-red-900/50 text-red-400 hover:border-red-500 hover:bg-red-950/30 hover:text-red-300"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                  <path d="M10 11v6" />
                  <path d="M14 11v6" />
                  <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
                </svg>
              </button>
            ) : null}
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="secondary" onClick={props.onClose}>
              Cancel
            </Button>
            <Button type="button" onClick={() => props.onSave(draft)}>
              Save
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function NpcPresetModal(props: {
  empireNpcs: EmpireNpcRow[];
  onAdd: (npcKey: string, presetAction: NpcPresetAction) => void;
  onClose: () => void;
}) {
  const [npcKey, setNpcKey] = useState(props.empireNpcs[0]?.key ?? "");

  function submit(presetAction: NpcPresetAction) {
    const trimmedNpcKey = npcKey.trim();
    if (trimmedNpcKey.length === 0) {
      return;
    }
    props.onAdd(trimmedNpcKey, presetAction);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) props.onClose();
      }}
    >
      <div className="my-8 w-full max-w-md rounded-lg border border-st-border bg-st-bg shadow-xl">
        <div className="border-b border-st-border px-6 py-4">
          <h3 className="text-sm font-semibold text-st-fg">Add NPC preset</h3>
          <p className="mt-1 text-xs text-st-muted">
            Select an NPC persona and preset behavior to automatically create a new NPC empire slot.
          </p>
        </div>
        <div className="space-y-4 px-6 py-5">
          <label className="grid gap-1 text-xs text-st-muted">
            <span>NPC persona</span>
            <select
              value={npcKey}
              onChange={(e) => setNpcKey(e.target.value)}
              className="rounded border border-st-border bg-st-panel px-3 py-2 text-sm text-st-fg outline-none focus:border-st-accent"
            >
              <option value="">Choose NPC persona</option>
              {props.empireNpcs.map((npc) => (
                <option key={npc.key} value={npc.key}>
                  {npc.playerName} ({npc.key})
                </option>
              ))}
            </select>
          </label>
          <p className="text-xs text-st-muted">
            The NPC will be added as a new slot in its own empire. Scenario buttons below apply the
            preset behavior to that slot.
          </p>

          <div className="space-y-2">
            <p className="text-xs font-medium uppercase tracking-wide text-st-muted">Scenario buttons</p>
            <div className="grid gap-2 sm:grid-cols-2">
              <Button type="button" variant="secondary" disabled={npcKey.trim().length === 0} onClick={() => submit("plain")}>
                Create slot
              </Button>
              <Button type="button" variant="secondary" disabled={npcKey.trim().length === 0} onClick={() => submit("delay_ai_start")}>
                Delay AI start
              </Button>
              <Button type="button" variant="secondary" disabled={npcKey.trim().length === 0} onClick={() => submit("light_handicap")}>
                Apply light handicap
              </Button>
              <Button type="button" variant="secondary" disabled={npcKey.trim().length === 0} onClick={() => submit("fight_attraction")}>
                Add fight attraction
              </Button>
              <Button type="button" variant="secondary" disabled={npcKey.trim().length === 0} onClick={() => submit("intruder_reveal")}>
                Add intruder reveal
              </Button>
            </div>
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-st-border px-6 py-4">
          <Button type="button" variant="secondary" onClick={props.onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={npcKey.trim().length === 0}
            onClick={() => {
              submit("plain");
            }}
          >
            Create slot
          </Button>
        </div>
      </div>
    </div>
  );
}

export function MissionScenarioPreview(props: {
  scenario: MissionScenario;
  empireNpcs: EmpireNpcRow[];
  strategies: StrategyOption[];
  onApplyWarningFix: (warning: MissionScenarioWarning) => void;
  onAddSlot?: () => void;
  onAddNpcPreset?: () => void;
  onEditSlot?: (slotIndex: number) => void;
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
          <div className="font-semibold text-st-fg">Player Slot</div>
          <div className="mt-1">{props.scenario.slots.find((slot) => slot.occupant.kind === "human")?.slotKey ?? "Invalid"}</div>
        </div>
        <div className="rounded border border-st-border bg-st-bg px-3 py-2 text-xs text-st-muted">
          <div className="font-semibold text-st-fg">Slots</div>
          <div className="mt-1">{props.scenario.slots.length}</div>
        </div>
        <div className="rounded border border-st-border bg-st-bg px-3 py-2 text-xs text-st-muted">
          <div className="font-semibold text-st-fg">NPC Occupants</div>
          <div className="mt-1">{props.scenario.slots.filter((slot) => slot.occupant.kind === "npc").length}</div>
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <div className="text-xs font-semibold uppercase tracking-wide text-st-muted">Slot Summary</div>
          <div className="flex gap-2">
            {props.onAddNpcPreset ? (
              <Button
                type="button"
                variant="secondary"
                onClick={props.onAddNpcPreset}
                className="h-auto px-2 py-1 text-xs"
              >
                Add NPC preset
              </Button>
            ) : null}
            {props.onAddSlot ? (
              <Button
                type="button"
                variant="secondary"
                onClick={props.onAddSlot}
                className="h-auto px-2 py-1 text-xs"
              >
                + Add slot
              </Button>
            ) : null}
          </div>
        </div>
        {props.scenario.slots.length === 0 ? (
          <p className="rounded border border-st-border bg-st-bg px-3 py-2 text-xs text-st-muted">
            No slots configured.
          </p>
        ) : (
          props.scenario.slots.map((slot, index) => {
            const npc =
              slot.occupant.kind === "npc" ? npcByKey.get(slot.occupant.npcPlayerKey) ?? null : null;
            const strategy =
              slot.automation.strategyLibraryKey === null
                ? null
                : strategyByKey.get(slot.automation.strategyLibraryKey) ?? null;
            return (
              <div
                key={`${slot.slotKey || "slot"}-${index}`}
                role={props.onEditSlot ? "button" : undefined}
                tabIndex={props.onEditSlot ? 0 : undefined}
                onClick={props.onEditSlot ? () => props.onEditSlot!(index) : undefined}
                onKeyDown={
                  props.onEditSlot
                    ? (e) => {
                        if (e.key === "Enter" || e.key === " ") props.onEditSlot!(index);
                      }
                    : undefined
                }
                className={`rounded border border-st-border bg-st-bg px-3 py-2 text-xs text-st-muted${
                  props.onEditSlot ? " cursor-pointer hover:border-st-accent" : ""
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-st-fg">
                    {slot.slotKey || `Slot ${index + 1}`}
                  </span>
                  {slot.occupant.kind === "human" ? (
                    <span className="rounded bg-st-accent/20 px-1.5 py-0.5 text-xs font-medium text-st-accent">
                      Player slot
                    </span>
                  ) : null}
                </div>
                <div className="mt-1">
                  Occupant: {slot.occupant.kind === "npc" ? npc?.playerName ?? slot.occupant.npcPlayerKey : "human"}
                </div>
                <div className="mt-1">
                  Strategy: {strategy?.name ?? slot.automation.strategyLibraryKey ?? "Occupant default / none"}
                  {slot.automation.activationTrigger !== null
                    ? slot.automation.activationTrigger.kind === "turn"
                      ? ` · Activates turn ${slot.automation.activationTrigger.turn}`
                      : slot.automation.activationTrigger.kind === "attacked"
                        ? " · Activates when attacked"
                        : ` · Activates on intruder detection (${slot.automation.activationTrigger.routeSteps} steps)`
                    : ""}
                </div>
                <div className="mt-1">
                  Handicap: {hasMissionHandicap(slot) ? "yes" : "none"}
                  {slot.sensors.fightAttraction !== null ? ` · Fight attraction ${slot.sensors.fightAttraction}` : ""}
                  {slot.sensors.intruderDetection !== null ? ` · Intruder detection ${slot.sensors.intruderDetection.routeSteps} steps` : ""}
                  {slot.startsHidden ? " · Starts hidden" : ""}
                  {slot.presentation.factionLabelOverride !== null ? ` · Faction label ${slot.presentation.factionLabelOverride}` : ""}
                  {slot.presentation.displayNameOverride !== null ? ` · Display name ${slot.presentation.displayNameOverride}` : ""}
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

export function MissionScenarioEditor(props: {
  scenarioJson: string;
  onScenarioJsonChange: (value: string) => void;
  empireNpcs: EmpireNpcRow[];
  strategies: StrategyOption[];
}) {
  const parsed = useMemo(() => parseMissionScenarioJson(props.scenarioJson), [props.scenarioJson]);
  const [modalState, setModalState] = useState<SlotModalState>({ kind: "closed" });
  const [npcPresetModalOpen, setNpcPresetModalOpen] = useState(false);

  function updateScenario(updater: (scenario: MissionScenario) => MissionScenario) {
    if (parsed.scenario === null) {
      return;
    }
    props.onScenarioJsonChange(toMissionScenarioJson(updater(parsed.scenario)));
  }

  function applyWarningFix(warning: MissionScenarioWarning) {
    const action = warning.action;
    if (action === null) {
      return;
    }

    if (action.kind === "setHumanOccupant") {
      updateScenario((scenario) => ({
        ...scenario,
        slots: scenario.slots.map((slot) =>
          slot.slotKey === action.slotKey ? { ...slot, occupant: { kind: "human" } } : slot,
        ),
      }));
    }
  }

  return (
    <div className="space-y-4 rounded-lg border border-st-border bg-st-bg/40 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h4 className="text-sm font-semibold text-st-fg">Scenario Builder</h4>
          <p className="mt-1 text-xs text-st-muted">
            Use the structured controls for common mission setup, then fine-tune the raw JSON if
            needed.
          </p>
        </div>
        <span className="shrink-0 text-xs text-st-muted/60">Schema v2</span>
      </div>

      {parsed.error !== null ? (
        <p className="rounded border border-red-900/50 bg-red-950/30 px-3 py-2 text-xs text-red-200">
          Fix the raw scenario JSON to continue using the structured editor: {parsed.error}
        </p>
      ) : null}

      {parsed.scenario !== null ? (
        <MissionScenarioPreview
          scenario={parsed.scenario}
          empireNpcs={props.empireNpcs}
          strategies={props.strategies}
          onApplyWarningFix={applyWarningFix}
          onAddSlot={() => setModalState({ kind: "create" })}
          onAddNpcPreset={() => setNpcPresetModalOpen(true)}
          onEditSlot={(slotIndex) => setModalState({ kind: "edit", slotIndex })}
        />
      ) : null}

      {npcPresetModalOpen && parsed.scenario !== null ? (
        <NpcPresetModal
          empireNpcs={props.empireNpcs}
          onAdd={(npcKey, presetAction) => {
            const currentSlots = parsed.scenario!.slots;
            const slot = createNpcPresetSlot({
              npcKey,
              presetType: "commander",
              presetAction,
              slots: currentSlots,
            });
            updateScenario((scenario) => ({
              ...scenario,
              slots: [...scenario.slots, slot],
            }));
            setNpcPresetModalOpen(false);
          }}
          onClose={() => setNpcPresetModalOpen(false)}
        />
      ) : null}

      {modalState.kind !== "closed" && parsed.scenario !== null ? (
        <SlotModal
          initialSlot={
            modalState.kind === "edit"
              ? (parsed.scenario.slots[modalState.slotIndex] ?? createEmptyMissionSlot())
              : createEmptyMissionSlot()
          }
          isCreate={modalState.kind === "create"}
          empireNpcs={props.empireNpcs}
          strategies={props.strategies}
          onSave={(slot) => {
            if (modalState.kind === "create") {
              updateScenario((scenario) => ({
                ...scenario,
                slots: [...scenario.slots, slot],
              }));
            } else if (modalState.kind === "edit") {
              const idx = modalState.slotIndex;
              updateScenario((scenario) => ({
                ...scenario,
                slots: scenario.slots.map((s, i) => (i === idx ? slot : s)),
              }));
            }
            setModalState({ kind: "closed" });
          }}
          onDelete={
            modalState.kind === "edit"
              ? () => {
                  const idx = modalState.slotIndex;
                  updateScenario((scenario) => ({
                    ...scenario,
                    slots: scenario.slots.filter((_, i) => i !== idx),
                  }));
                  setModalState({ kind: "closed" });
                }
              : undefined
          }
          onClose={() => setModalState({ kind: "closed" })}
        />
      ) : null}

    </div>
  );
}
