import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import type { Doc, Id } from "../../../../convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useActiveGame } from "@/features/galaxy/hooks/useActiveGame";
import {
  formatStrategyJson,
  NPC_EMPIRE_STRATEGIES,
  PRIORITY_STAR_MAX_STRATEGY,
} from "@/features/empire/strategies/npcStrategies";
import { IMPROVED_HUMAN_AUTOPILOT_PRIORITY_STRATEGY } from "@/features/empire/strategies/humanStrategies";

function formatStrategyText(strategyJson: string | undefined): string {
  if (strategyJson === undefined) return "";
  try {
    return JSON.stringify(JSON.parse(strategyJson), null, 2);
  } catch {
    return strategyJson;
  }
}

function validateStrategyText(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    throw new Error("Strategy JSON cannot be empty.");
  }
  const parsed: unknown = JSON.parse(trimmed);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("Strategy JSON must be a JSON object.");
  }
  return JSON.stringify(parsed, null, 2);
}

function mutationErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  return raw.replace(/^[\s\S]*?Error:\s*/g, "").trim() || "Something went wrong.";
}

function formatPreview(preview: {
  stance: string;
  earlyRush: boolean;
  reserveShipsPct: number;
  reinforceAttackedSystems: boolean;
} | null): string {
  if (preview === null) {
    return "No automation preview available.";
  }
  return [
    `Stance ${preview.stance}`,
    `Reserve ${preview.reserveShipsPct}%`,
    preview.earlyRush ? "Early rush on" : "Early rush off",
    preview.reinforceAttackedSystems ? "Reinforce attacked worlds" : "No auto reinforcement",
  ].join(" · ");
}

function formatTimestamp(value: number | undefined): string {
  if (value === undefined) {
    return "Never";
  }
  return new Date(value).toLocaleString();
}

async function copyTextToClipboard(text: string): Promise<void> {
  if (typeof navigator === "undefined" || navigator.clipboard?.writeText === undefined) {
    throw new Error("Clipboard access is unavailable in this browser.");
  }
  await navigator.clipboard.writeText(text);
}

type PublicAutomationStrategyRow = {
  key: string;
  name: string;
  description: string;
  tags: string[];
  strategyJson: string;
  preview: {
    stance: string;
    earlyRush: boolean;
    reserveShipsPct: number;
    reinforceAttackedSystems: boolean;
  } | null;
};

type AutomationProfileRow = {
  _id: Id<"usr_automation_profiles">;
  name: string;
  description?: string;
  sourceKind: "custom" | "library";
  sourceLibraryKey?: string;
  overridesJson?: string;
  strategyJson: string;
  createdAt: number;
  updatedAt: number;
  lastUsedAt?: number;
  sourceLibrary: PublicAutomationStrategyRow | null;
  automationPreview: PublicAutomationStrategyRow["preview"];
};

function LibraryStrategyCard(props: {
  strategy: PublicAutomationStrategyRow;
  onCreate: (params: {
    libraryKey: string;
    name: string;
    description: string | null;
    overridesJson: string | null;
  }) => Promise<void>;
  onLoadStrategy: (strategyJson: string) => void;
}) {
  const [name, setName] = useState(`${props.strategy.name} Copy`);
  const [description, setDescription] = useState(props.strategy.description);
  const [overridesText, setOverridesText] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function saveToProfile() {
    setIsSaving(true);
    setStatus(null);
    setError(null);
    try {
      await props.onCreate({
        libraryKey: props.strategy.key,
        name,
        description,
        overridesJson: overridesText.trim().length > 0 ? overridesText : null,
      });
      setStatus("Saved to your automation profiles.");
      setOverridesText("");
    } catch (saveError) {
      setError(mutationErrorMessage(saveError));
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <details className="rounded-lg border border-st-border bg-st-panel/50 p-3">
      <summary className="cursor-pointer text-sm font-medium text-st-fg">{props.strategy.name}</summary>
      <div className="mt-3 space-y-3">
        <p className="text-xs text-st-muted">{props.strategy.description}</p>
        <p className="text-[11px] text-st-muted">{formatPreview(props.strategy.preview)}</p>
        <div className="flex flex-wrap gap-2 text-[11px] text-st-muted">
          {props.strategy.tags.map((tag) => (
            <span key={tag} className="rounded-full border border-st-border px-2 py-0.5">
              {tag}
            </span>
          ))}
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="space-y-1 text-xs text-st-muted">
            <span>Profile name</span>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              className="w-full rounded border border-st-border bg-st-panel px-3 py-2 text-sm text-st-fg outline-none focus:border-st-accent"
            />
          </label>
          <label className="space-y-1 text-xs text-st-muted">
            <span>Description</span>
            <input
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              className="w-full rounded border border-st-border bg-st-panel px-3 py-2 text-sm text-st-fg outline-none focus:border-st-accent"
            />
          </label>
        </div>
        <label className="space-y-1 text-xs text-st-muted">
          <span>Numeric overrides JSON</span>
          <textarea
            value={overridesText}
            onChange={(event) => setOverridesText(event.target.value)}
            rows={8}
            spellCheck={false}
            className="w-full rounded border border-st-border bg-slate-950/60 px-3 py-2 font-mono text-xs text-st-fg outline-none focus:border-st-accent"
            placeholder='{"expansion":{"reserveShipsPct":22},"borderPolicy":{"attackAdvantageRequired":1.2}}'
          />
        </label>
        <div className="flex flex-wrap gap-2">
          <Button type="button" onClick={() => void saveToProfile()} disabled={isSaving}>
            {isSaving ? "Saving..." : "Copy To My Profiles"}
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => props.onLoadStrategy(props.strategy.strategyJson)}
          >
            Load Into Editor
          </Button>
        </div>
        {status !== null ? <p className="text-xs text-emerald-400">{status}</p> : null}
        {error !== null ? <p className="text-xs text-red-400">{error}</p> : null}
      </div>
    </details>
  );
}

function SavedAutomationProfileCard(props: {
  profile: AutomationProfileRow;
  onApply: (strategyJson: string) => Promise<void>;
  onLoadStrategy: (strategyJson: string) => void;
  onUpdateCustom: (params: {
    profileId: Id<"usr_automation_profiles">;
    name?: string;
    description?: string | null;
    strategyJson?: string;
  }) => Promise<unknown>;
  onUpdateLibrary: (params: {
    profileId: Id<"usr_automation_profiles">;
    name?: string;
    description?: string | null;
    overridesJson?: string | null;
  }) => Promise<unknown>;
  onDuplicate: (params: {
    profileId: Id<"usr_automation_profiles">;
    name?: string;
  }) => Promise<unknown>;
  onDelete: (profileId: Id<"usr_automation_profiles">) => Promise<unknown>;
}) {
  const { profile } = props;
  const [name, setName] = useState(profile.name);
  const [description, setDescription] = useState(profile.description ?? "");
  const [strategyText, setStrategyText] = useState(profile.strategyJson);
  const [overridesText, setOverridesText] = useState(profile.overridesJson ?? "");
  const [isBusy, setIsBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setName(profile.name);
    setDescription(profile.description ?? "");
    setStrategyText(profile.strategyJson);
    setOverridesText(profile.overridesJson ?? "");
  }, [profile]);

  async function handleSave() {
    setIsBusy(true);
    setStatus(null);
    setError(null);
    try {
      if (profile.sourceKind === "custom") {
        await props.onUpdateCustom({
          profileId: profile._id,
          name,
          description,
          strategyJson: strategyText,
        });
      } else {
        await props.onUpdateLibrary({
          profileId: profile._id,
          name,
          description,
          overridesJson: overridesText.trim().length > 0 ? overridesText : null,
        });
      }
      setStatus("Saved profile changes.");
    } catch (saveError) {
      setError(mutationErrorMessage(saveError));
    } finally {
      setIsBusy(false);
    }
  }

  async function handleApply() {
    setIsBusy(true);
    setStatus(null);
    setError(null);
    try {
      await props.onApply(profile.strategyJson);
      setStatus("Applied to the current empire.");
    } catch (applyError) {
      setError(mutationErrorMessage(applyError));
    } finally {
      setIsBusy(false);
    }
  }

  async function handleDuplicate() {
    setIsBusy(true);
    setStatus(null);
    setError(null);
    try {
      await props.onDuplicate({ profileId: profile._id, name: `${name} Copy` });
      setStatus("Duplicated profile.");
    } catch (duplicateError) {
      setError(mutationErrorMessage(duplicateError));
    } finally {
      setIsBusy(false);
    }
  }

  async function handleExport() {
    setStatus(null);
    setError(null);
    try {
      await copyTextToClipboard(profile.strategyJson);
      setStatus("Copied strategy JSON to clipboard.");
    } catch (copyError) {
      setError(mutationErrorMessage(copyError));
    }
  }

  async function handleDelete() {
    setIsBusy(true);
    setStatus(null);
    setError(null);
    try {
      await props.onDelete(profile._id);
    } catch (deleteError) {
      setError(mutationErrorMessage(deleteError));
      setIsBusy(false);
    }
  }

  return (
    <details className="rounded-lg border border-st-border bg-st-panel/50 p-3">
      <summary className="cursor-pointer text-sm font-medium text-st-fg">{profile.name}</summary>
      <div className="mt-3 space-y-3">
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-st-muted">
          <span className="rounded-full border border-st-border px-2 py-0.5">
            {profile.sourceKind === "library" ? "Library-derived" : "Custom"}
          </span>
          {profile.sourceLibrary !== null ? (
            <span className="rounded-full border border-st-border px-2 py-0.5">
              Source {profile.sourceLibrary.name}
            </span>
          ) : null}
          <span>Updated {formatTimestamp(profile.updatedAt)}</span>
          <span>Last used {formatTimestamp(profile.lastUsedAt)}</span>
        </div>
        <p className="text-[11px] text-st-muted">{formatPreview(profile.automationPreview)}</p>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="space-y-1 text-xs text-st-muted">
            <span>Profile name</span>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              className="w-full rounded border border-st-border bg-st-panel px-3 py-2 text-sm text-st-fg outline-none focus:border-st-accent"
            />
          </label>
          <label className="space-y-1 text-xs text-st-muted">
            <span>Description</span>
            <input
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              className="w-full rounded border border-st-border bg-st-panel px-3 py-2 text-sm text-st-fg outline-none focus:border-st-accent"
            />
          </label>
        </div>
        {profile.sourceKind === "custom" ? (
          <label className="space-y-1 text-xs text-st-muted">
            <span>Strategy JSON</span>
            <textarea
              value={strategyText}
              onChange={(event) => setStrategyText(event.target.value)}
              rows={10}
              spellCheck={false}
              className="w-full rounded border border-st-border bg-slate-950/60 px-3 py-2 font-mono text-xs text-st-fg outline-none focus:border-st-accent"
            />
          </label>
        ) : (
          <label className="space-y-1 text-xs text-st-muted">
            <span>Overrides JSON</span>
            <textarea
              value={overridesText}
              onChange={(event) => setOverridesText(event.target.value)}
              rows={8}
              spellCheck={false}
              className="w-full rounded border border-st-border bg-slate-950/60 px-3 py-2 font-mono text-xs text-st-fg outline-none focus:border-st-accent"
              placeholder='{"expansion":{"reserveShipsPct":24}}'
            />
          </label>
        )}
        <div className="flex flex-wrap gap-2">
          <Button type="button" onClick={() => void handleApply()} disabled={isBusy}>
            Apply To Empire
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => props.onLoadStrategy(profile.strategyJson)}
            disabled={isBusy}
          >
            Load Into Editor
          </Button>
          <Button type="button" variant="secondary" onClick={() => void handleSave()} disabled={isBusy}>
            Save Changes
          </Button>
          <Button type="button" variant="secondary" onClick={() => void handleDuplicate()} disabled={isBusy}>
            Duplicate
          </Button>
          <Button type="button" variant="outline" onClick={() => void handleExport()} disabled={isBusy}>
            Export JSON
          </Button>
          <Button type="button" variant="ghost" onClick={() => void handleDelete()} disabled={isBusy}>
            Delete
          </Button>
        </div>
        {status !== null ? <p className="text-xs text-emerald-400">{status}</p> : null}
        {error !== null ? <p className="text-xs text-red-400">{error}</p> : null}
      </div>
    </details>
  );
}

function AutomationProfilesPanel(props: {
  empire: Doc<"emp_states">;
  strategyText: string;
  setStrategyText: (value: string) => void;
}) {
  const publicStrategiesQuery = useQuery(api.usr.queries.listPublicAutomationStrategies, {});
  const profilesQuery = useQuery(api.usr.queries.listMyAutomationProfiles, {});
  const createCustomAutomationProfile = useMutation(api.usr.mutations.createCustomAutomationProfile);
  const createAutomationProfileFromLibrary = useMutation(
    api.usr.mutations.createAutomationProfileFromLibrary,
  );
  const updateCustomAutomationProfile = useMutation(api.usr.mutations.updateCustomAutomationProfile);
  const updateLibraryAutomationProfile = useMutation(api.usr.mutations.updateLibraryAutomationProfile);
  const duplicateMyAutomationProfile = useMutation(api.usr.mutations.duplicateMyAutomationProfile);
  const deleteMyAutomationProfile = useMutation(api.usr.mutations.deleteMyAutomationProfile);
  const updateEmpireMeta = useMutation(api.emp.mutations.updateEmpireMeta);

  const publicStrategies = (publicStrategiesQuery ?? []) as PublicAutomationStrategyRow[];
  const profiles = (profilesQuery ?? []) as AutomationProfileRow[];

  const [saveName, setSaveName] = useState(`${props.empire.name} Strategy`);
  const [saveDescription, setSaveDescription] = useState("");
  const [importName, setImportName] = useState("");
  const [importDescription, setImportDescription] = useState("");
  const [importText, setImportText] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  async function saveCurrentStrategy() {
    setIsBusy(true);
    setStatus(null);
    setError(null);
    try {
      const normalized = validateStrategyText(props.strategyText);
      await createCustomAutomationProfile({
        name: saveName,
        description: saveDescription.trim().length > 0 ? saveDescription : null,
        strategyJson: normalized,
      });
      setStatus("Saved the current strategy to your profile library.");
    } catch (saveError) {
      setError(mutationErrorMessage(saveError));
    } finally {
      setIsBusy(false);
    }
  }

  async function importCustomProfile() {
    setIsBusy(true);
    setStatus(null);
    setError(null);
    try {
      const normalized = validateStrategyText(importText);
      await createCustomAutomationProfile({
        name: importName,
        description: importDescription.trim().length > 0 ? importDescription : null,
        strategyJson: normalized,
      });
      setStatus("Imported strategy JSON into your profile library.");
      setImportName("");
      setImportDescription("");
      setImportText("");
    } catch (importError) {
      setError(mutationErrorMessage(importError));
    } finally {
      setIsBusy(false);
    }
  }

  async function applyProfileStrategy(strategyJson: string) {
    const normalized = validateStrategyText(strategyJson);
    await updateEmpireMeta({
      empireId: props.empire._id,
      strategyJson: normalized,
    });
    props.setStrategyText(normalized);
    setStatus("Applied saved strategy to the empire editor and backend.");
    setError(null);
  }

  return (
    <div className="space-y-4 border-t border-st-border pt-4">
      <div>
        <h3 className="text-sm font-semibold uppercase tracking-wide text-st-muted">
          Automation Profile Library
        </h3>
        <p className="mt-1 text-xs text-st-muted">
          Save 0-n personal automation profiles, branch public presets with numeric overrides,
          export/import JSON, and apply any saved profile to this empire.
        </p>
      </div>

      <Card className="bg-st-panel/60">
        <h4 className="text-sm font-medium text-st-fg">Save Current Strategy</h4>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <label className="space-y-1 text-xs text-st-muted">
            <span>Profile name</span>
            <input
              value={saveName}
              onChange={(event) => setSaveName(event.target.value)}
              className="w-full rounded border border-st-border bg-st-panel px-3 py-2 text-sm text-st-fg outline-none focus:border-st-accent"
            />
          </label>
          <label className="space-y-1 text-xs text-st-muted">
            <span>Description</span>
            <input
              value={saveDescription}
              onChange={(event) => setSaveDescription(event.target.value)}
              className="w-full rounded border border-st-border bg-st-panel px-3 py-2 text-sm text-st-fg outline-none focus:border-st-accent"
            />
          </label>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button type="button" onClick={() => void saveCurrentStrategy()} disabled={isBusy}>
            Save Current As Profile
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => void copyTextToClipboard(props.strategyText).then(
              () => {
                setStatus("Copied current strategy JSON to clipboard.");
                setError(null);
              },
              (copyError: unknown) => {
                setError(mutationErrorMessage(copyError));
              },
            )}
          >
            Export Current JSON
          </Button>
        </div>
      </Card>

      <details className="rounded-lg border border-st-border bg-st-panel/50 p-3">
        <summary className="cursor-pointer text-sm font-medium text-st-fg">
          Import Custom Strategy JSON
        </summary>
        <div className="mt-3 space-y-3">
          <div className="grid gap-3 md:grid-cols-2">
            <label className="space-y-1 text-xs text-st-muted">
              <span>Profile name</span>
              <input
                value={importName}
                onChange={(event) => setImportName(event.target.value)}
                className="w-full rounded border border-st-border bg-st-panel px-3 py-2 text-sm text-st-fg outline-none focus:border-st-accent"
              />
            </label>
            <label className="space-y-1 text-xs text-st-muted">
              <span>Description</span>
              <input
                value={importDescription}
                onChange={(event) => setImportDescription(event.target.value)}
                className="w-full rounded border border-st-border bg-st-panel px-3 py-2 text-sm text-st-fg outline-none focus:border-st-accent"
              />
            </label>
          </div>
          <textarea
            value={importText}
            onChange={(event) => setImportText(event.target.value)}
            rows={10}
            spellCheck={false}
            className="w-full rounded border border-st-border bg-slate-950/60 px-3 py-2 font-mono text-xs text-st-fg outline-none focus:border-st-accent"
            placeholder='{"archetype":"My tuned branch","expansion":{"reserveShipsPct":20}}'
          />
          <Button type="button" onClick={() => void importCustomProfile()} disabled={isBusy}>
            Import Profile
          </Button>
        </div>
      </details>

      <div className="space-y-3">
        <h4 className="text-sm font-medium text-st-fg">Public Library</h4>
        {publicStrategiesQuery === undefined ? (
          <p className="text-xs text-st-muted">Loading public strategies...</p>
        ) : (
          publicStrategies.map((strategy) => (
            <LibraryStrategyCard
              key={strategy.key}
              strategy={strategy}
              onCreate={async (params) => {
                await createAutomationProfileFromLibrary(params);
                setStatus(`Saved ${params.name} to your automation profiles.`);
                setError(null);
              }}
              onLoadStrategy={(strategyJson) => {
                props.setStrategyText(strategyJson);
                setStatus(`Loaded ${strategy.name} into the editor.`);
                setError(null);
              }}
            />
          ))
        )}
      </div>

      <div className="space-y-3">
        <h4 className="text-sm font-medium text-st-fg">Your Saved Profiles</h4>
        {profilesQuery === undefined ? (
          <p className="text-xs text-st-muted">Loading your profiles...</p>
        ) : profiles.length === 0 ? (
          <p className="text-xs text-st-muted">No saved automation profiles yet.</p>
        ) : (
          profiles.map((profile) => (
            <SavedAutomationProfileCard
              key={profile._id}
              profile={profile}
              onApply={applyProfileStrategy}
              onLoadStrategy={(strategyJson) => {
                props.setStrategyText(strategyJson);
                setStatus(`Loaded ${profile.name} into the editor.`);
                setError(null);
              }}
              onUpdateCustom={updateCustomAutomationProfile}
              onUpdateLibrary={updateLibraryAutomationProfile}
              onDuplicate={duplicateMyAutomationProfile}
              onDelete={(profileId) => deleteMyAutomationProfile({ profileId })}
            />
          ))
        )}
      </div>

      {status !== null ? <p className="text-xs text-emerald-400">{status}</p> : null}
      {error !== null ? <p className="text-xs text-red-400">{error}</p> : null}
    </div>
  );
}

function EmpireEditor({ empire }: { empire: Doc<"emp_states"> }) {
  const updateEmpireMeta = useMutation(api.emp.mutations.updateEmpireMeta);
  const [name, setName] = useState(empire.name);
  const [colorHex, setColorHex] = useState(empire.colorHex);
  const [playerName, setPlayerName] = useState(empire.playerName ?? "");
  const [strategyText, setStrategyText] = useState(formatStrategyText(empire.strategyJson));
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const defaultStrategy = useMemo(() => {
    if (empire.npcPlayerKey === undefined) return undefined;
    return NPC_EMPIRE_STRATEGIES[empire.npcPlayerKey];
  }, [empire.npcPlayerKey]);

  async function saveProfile(nextColorHex = colorHex) {
    setIsSaving(true);
    setError(null);
    setStatus(null);
    try {
      await updateEmpireMeta({
        empireId: empire._id,
        name,
        colorHex: nextColorHex,
        playerName,
      });
      setStatus("Saved profile.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save profile.");
    } finally {
      setIsSaving(false);
    }
  }

  async function saveStrategy() {
    setIsSaving(true);
    setError(null);
    setStatus(null);
    try {
      const normalized = validateStrategyText(strategyText);
      await updateEmpireMeta({
        empireId: empire._id,
        strategyJson: normalized,
      });
      setStrategyText(normalized);
      setStatus("Saved strategy.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Strategy JSON is invalid.");
    } finally {
      setIsSaving(false);
    }
  }

  function loadDefaultStrategy() {
    if (defaultStrategy === undefined) return;
    setStrategyText(formatStrategyJson(defaultStrategy));
    setStatus("Loaded default strategy. Save to persist it.");
    setError(null);
  }

  function loadPriorityExampleStrategy() {
    setStrategyText(formatStrategyJson(PRIORITY_STAR_MAX_STRATEGY));
    setStatus("Loaded Priority star showcase strategy. Save to persist it.");
    setError(null);
  }

  function loadImprovedHumanAutopilotStrategy() {
    setStrategyText(formatStrategyJson(IMPROVED_HUMAN_AUTOPILOT_PRIORITY_STRATEGY));
    setStatus("Loaded improved human autopilot strategy. Save to persist it.");
    setError(null);
  }

  return (
    <Card>
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <input
              type="color"
              value={colorHex}
              onChange={(event) => {
                const next = event.target.value;
                setColorHex(next);
                void saveProfile(next);
              }}
              aria-label={`Empire color for ${empire.name}`}
              className="h-10 w-10 cursor-pointer rounded border border-st-border bg-st-panel"
            />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="truncate text-base font-semibold text-st-fg">{empire.name}</h2>
                <span className="rounded border border-st-border px-2 py-0.5 text-[11px] uppercase tracking-wide text-st-muted">
                  {empire.controller === "npc" ? "NPC" : "Human"}
                </span>
              </div>
              <p className="text-xs text-st-muted">
                {empire.playerName ?? "No player name set"}
                {empire.npcPlayerKey !== undefined ? ` · ${empire.npcPlayerKey}` : ""}
              </p>
            </div>
          </div>
          <Button type="button" onClick={() => void saveProfile()} disabled={isSaving}>
            Save Profile
          </Button>
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          <label className="space-y-1 text-xs text-st-muted">
            <span>Empire Name</span>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              onBlur={() => void saveProfile()}
              className="w-full rounded border border-st-border bg-st-panel px-3 py-2 text-sm text-st-fg outline-none focus:border-st-accent"
            />
          </label>
          <label className="space-y-1 text-xs text-st-muted">
            <span>Player Name</span>
            <input
              value={playerName}
              onChange={(event) => setPlayerName(event.target.value)}
              onBlur={() => void saveProfile()}
              className="w-full rounded border border-st-border bg-st-panel px-3 py-2 text-sm text-st-fg outline-none focus:border-st-accent"
            />
          </label>
          <label className="space-y-1 text-xs text-st-muted">
            <span>Color Hex</span>
            <input
              value={colorHex}
              onChange={(event) => setColorHex(event.target.value)}
              onBlur={() => void saveProfile()}
              className="w-full rounded border border-st-border bg-st-panel px-3 py-2 font-mono text-sm text-st-fg outline-none focus:border-st-accent"
            />
          </label>
        </div>

        <details className="rounded-lg border border-st-border bg-st-panel/60 p-3">
          <summary className="cursor-pointer text-sm font-medium text-st-fg">
            Automation Strategy
          </summary>
          <div className="mt-3 space-y-3">
            <p className="text-xs text-st-muted">
              Save a JSON brain for NPC empires or human empires that should run on scriptable
              automation. The turn runner applies economy settings and maintains strategy-managed
              standing routes for expansion, border reinforcement, and attacks.
            </p>
            <textarea
              value={strategyText}
              onChange={(event) => setStrategyText(event.target.value)}
              rows={16}
              spellCheck={false}
              className="w-full rounded border border-st-border bg-slate-950/60 px-3 py-2 font-mono text-xs text-st-fg outline-none focus:border-st-accent"
              placeholder='{"archetype":"Balanced Strategist","economy":{"taxRateTarget":0.14}}'
            />
            <div className="flex flex-wrap gap-2">
              <Button type="button" onClick={() => void saveStrategy()} disabled={isSaving}>
                Save Strategy
              </Button>
              {defaultStrategy !== undefined ? (
                <Button type="button" variant="secondary" onClick={loadDefaultStrategy}>
                  Load Default
                </Button>
              ) : null}
              <Button
                type="button"
                variant="secondary"
                onClick={loadImprovedHumanAutopilotStrategy}
              >
                Load Human Autopilot
              </Button>
              <Button type="button" variant="secondary" onClick={loadPriorityExampleStrategy}>
                Load Priority Example
              </Button>
            </div>
          </div>
        </details>

        <AutomationProfilesPanel
          empire={empire}
          strategyText={strategyText}
          setStrategyText={setStrategyText}
        />

        {status !== null ? <p className="text-xs text-emerald-400">{status}</p> : null}
        {error !== null ? <p className="text-xs text-red-400">{error}</p> : null}
      </div>
    </Card>
  );
}

export function EmpiresPage(props: {
  /** When supplied (player home), list at most this empire (`null` = not present in this game). */
  onlyEmpireId?: Id<"emp_states"> | null;
  hideGamePicker?: boolean;
}) {
  const hideGamePicker = props.hideGamePicker === true;
  const playerEmpireFilter = "onlyEmpireId" in props;
  const onlyEmpireId = playerEmpireFilter ? props.onlyEmpireId ?? null : undefined;
  const { activeGame, games, setSelectedGameId } = useActiveGame();
  const empiresAllRaw = useQuery(
    api.emp.queries.listEmpires,
    activeGame ? { gameId: activeGame._id, limit: 64 } : "skip",
  );
  const empiresAll = useMemo(() => empiresAllRaw ?? [], [empiresAllRaw]);
  const empires = useMemo(() => {
    if (!playerEmpireFilter) return empiresAll;
    if (onlyEmpireId === null) return [];
    return empiresAll.filter((e) => e._id === onlyEmpireId);
  }, [empiresAll, onlyEmpireId, playerEmpireFilter]);
  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-6">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold text-st-fg">
          {playerEmpireFilter ? "Your empire" : "Empires"}
        </h1>
        <p className="text-sm text-st-muted">
          {playerEmpireFilter
            ? "Your faction profile and automation brain for this game."
            : "Manage empire identity, colors, and automation brains for human and NPC players. Empire colors you set here are saved to your account and applied when you create or seed a new map for Aurora, Iron, and each roster NPC persona."}
        </p>
      </div>

      {!hideGamePicker && games.length > 1 ? (
        <div className="flex flex-wrap gap-2">
          {games.map((game) => {
            const isActive = activeGame?._id === game._id;
            return (
              <button
                key={game._id}
                type="button"
                onClick={() => setSelectedGameId(game._id)}
                className={`rounded-md border px-3 py-1.5 text-sm transition-colors ${
                  isActive
                    ? "border-st-accent bg-st-accent/10 text-st-fg ring-1 ring-st-accent/30"
                    : "border-st-border text-st-muted hover:bg-st-panel hover:text-st-fg"
                }`}
              >
                {game.name}
                <span className="ml-1.5 text-xs opacity-60">{game.status}</span>
              </button>
            );
          })}
        </div>
      ) : null}

      {activeGame === null ? (
        <Card>
          <p className="text-sm text-st-muted">
            No game found. Create a game from the Admin panel first.
          </p>
        </Card>
      ) : (
        <>
          <div className="flex items-center gap-2 text-xs text-st-muted">
            <span className="font-medium text-st-fg">{activeGame.name}</span>
            <span>·</span>
            <span className="capitalize">{activeGame.status}</span>
            <span>·</span>
            <span>Turn {activeGame.currentTurn}</span>
          </div>

          <div className="space-y-4">
            {empires.length > 0 ? (
              empires.map((empire) => <EmpireEditor key={empire._id} empire={empire} />)
            ) : (
              <Card>
                <p className="text-sm text-st-muted">
                  {playerEmpireFilter && onlyEmpireId === null && empiresAll.length > 0
                    ? "Your assigned empire is not part of this game. Select a matching seeded game from the main app."
                    : "No empires have been seeded yet."}
                </p>
              </Card>
            )}
          </div>
        </>
      )}
    </div>
  );
}
