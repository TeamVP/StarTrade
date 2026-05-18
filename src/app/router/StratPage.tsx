import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

type StrategyPreview = {
  stance: string;
  earlyRush: boolean;
  reserveShipsPct: number;
  reinforceAttackedSystems: boolean;
} | null;

type PublicAutomationStrategyRow = {
  key: string;
  name: string;
  description: string;
  tags: string[];
  strategyJson: string;
  source: "official" | "community";
  preview: StrategyPreview;
};

type AutomationProfileRow = {
  _id: Id<"usr_automation_profiles">;
  name: string;
  description?: string;
  isActive?: boolean;
  sourceKind: "custom" | "library";
  sourceLibraryKey?: string;
  overridesJson?: string;
  strategyJson: string;
  createdAt: number;
  updatedAt: number;
  lastUsedAt?: number;
  sourceLibrary: PublicAutomationStrategyRow | null;
  automationPreview: StrategyPreview;
};

function mutationErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  return raw.replace(/^[\s\S]*?Error:\s*/g, "").trim() || "Something went wrong.";
}

function formatPreview(preview: StrategyPreview): string {
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

function LibraryRosterCard(props: {
  strategy: PublicAutomationStrategyRow;
  rosterCount: number;
  onAdd: (strategy: PublicAutomationStrategyRow) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showCodeModal, setShowCodeModal] = useState(false);

  async function handleAdd() {
    setBusy(true);
    setError(null);
    try {
      await props.onAdd(props.strategy);
    } catch (err) {
      setError(mutationErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="flex flex-col gap-3 bg-st-panel/60">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-st-fg">{props.strategy.name}</h3>
          <p className="mt-1 text-sm text-st-muted">{props.strategy.description}</p>
          <p className="mt-2 text-xs text-st-muted">{formatPreview(props.strategy.preview)}</p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <span className={`rounded border px-2 py-1 text-xs ${props.strategy.source === "community" ? "border-sky-500/40 bg-sky-950/30 text-sky-200" : "border-st-border text-st-muted"}`}>
            {props.strategy.source === "community" ? "Community" : "Official"}
          </span>
          <span className="rounded border border-st-border px-2 py-1 text-xs text-st-muted">
            {props.rosterCount} in roster
          </span>
        </div>
      </div>
      <div className="flex flex-wrap gap-2 text-xs text-st-muted">
        {props.strategy.tags.map((tag) => (
          <span key={tag} className="rounded border border-st-border px-2 py-0.5">
            {tag}
          </span>
        ))}
      </div>
      {error ? <p className="text-sm text-red-300">{error}</p> : null}
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="outline" onClick={() => setShowCodeModal(true)}>
          View Code
        </Button>
        <Button type="button" onClick={() => void handleAdd()} disabled={busy}>
          {busy ? "Adding..." : "Add To Roster"}
        </Button>
      </div>

      {showCodeModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 px-4 py-6">
          <div className="max-h-[85vh] w-full max-w-4xl overflow-hidden rounded-xl border border-st-border bg-st-bg shadow-2xl shadow-black/40">
            <div className="flex items-start justify-between gap-4 border-b border-st-border px-5 py-4">
              <div>
                <h4 className="text-base font-semibold text-st-fg">{props.strategy.name} code</h4>
                <p className="mt-1 text-sm text-st-muted">
                  Read-only strategy JSON for the public library entry.
                </p>
              </div>
              <Button type="button" variant="secondary" onClick={() => setShowCodeModal(false)}>
                Close
              </Button>
            </div>
            <div className="max-h-[calc(85vh-5rem)] overflow-auto px-5 py-4">
              <pre className="overflow-x-auto rounded-lg border border-st-border bg-slate-950/80 p-4 font-mono text-xs leading-6 text-st-fg">
                <code>{props.strategy.strategyJson}</code>
              </pre>
            </div>
          </div>
          <button
            type="button"
            aria-label="Close strategy code viewer"
            className="absolute inset-0 -z-10"
            onClick={() => setShowCodeModal(false)}
          />
        </div>
      ) : null}
    </Card>
  );
}

function SavedRosterProfileCard(props: {
  profile: AutomationProfileRow;
  onToggleActive: (profileId: Id<"usr_automation_profiles">, isActive: boolean) => Promise<void>;
  onSaveLibrary: (args: {
    profileId: Id<"usr_automation_profiles">;
    name: string;
    description: string | null;
    isActive: boolean;
    overridesJson: string | null;
  }) => Promise<void>;
  onSaveCustom: (args: {
    profileId: Id<"usr_automation_profiles">;
    name: string;
    description: string | null;
    isActive: boolean;
    strategyJson: string;
  }) => Promise<void>;
  onResetLibrary: (profileId: Id<"usr_automation_profiles">, isActive: boolean) => Promise<void>;
  onDelete: (profileId: Id<"usr_automation_profiles">) => Promise<void>;
}) {
  const [name, setName] = useState(props.profile.name);
  const [description, setDescription] = useState(props.profile.description ?? "");
  const [isActive, setIsActive] = useState(props.profile.isActive ?? true);
  const [overridesText, setOverridesText] = useState(props.profile.overridesJson ?? "");
  const [strategyText, setStrategyText] = useState(props.profile.strategyJson);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleToggleActive(nextValue: boolean) {
    setIsActive(nextValue);
    setBusy(true);
    setStatus(null);
    setError(null);
    try {
      await props.onToggleActive(props.profile._id, nextValue);
      setStatus(nextValue ? "Profile activated." : "Profile deactivated.");
    } catch (err) {
      setIsActive(!nextValue);
      setError(mutationErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleSave() {
    setBusy(true);
    setStatus(null);
    setError(null);
    try {
      if (props.profile.sourceKind === "library") {
        await props.onSaveLibrary({
          profileId: props.profile._id,
          name,
          description: description.trim().length > 0 ? description : null,
          isActive,
          overridesJson: overridesText.trim().length > 0 ? overridesText : null,
        });
      } else {
        await props.onSaveCustom({
          profileId: props.profile._id,
          name,
          description: description.trim().length > 0 ? description : null,
          isActive,
          strategyJson: validateStrategyText(strategyText),
        });
      }
      setStatus("Saved.");
    } catch (err) {
      setError(mutationErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleResetLibrary() {
    setBusy(true);
    setStatus(null);
    setError(null);
    try {
      await props.onResetLibrary(props.profile._id, isActive);
      setOverridesText("");
      setStatus("Reset to library defaults.");
    } catch (err) {
      setError(mutationErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    setBusy(true);
    setStatus(null);
    setError(null);
    try {
      await props.onDelete(props.profile._id);
    } catch (err) {
      setError(mutationErrorMessage(err));
      setBusy(false);
    }
  }

  return (
    <Card className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-st-fg">{props.profile.name}</h3>
            <span className="rounded border border-st-border px-2 py-0.5 text-xs text-st-muted">
              {props.profile.sourceKind === "library" ? "Library branch" : "Custom"}
            </span>
            {!isActive ? (
              <span className="rounded border border-amber-500/40 bg-amber-950/30 px-2 py-0.5 text-xs text-amber-200">
                Inactive
              </span>
            ) : null}
          </div>
          <p className="mt-1 text-xs text-st-muted">{formatPreview(props.profile.automationPreview)}</p>
          <p className="mt-1 text-xs text-st-muted">
            Updated {formatTimestamp(props.profile.updatedAt)} · Last used {formatTimestamp(props.profile.lastUsedAt)}
          </p>
        </div>
        <label className="flex items-center gap-2 text-sm text-st-muted">
          <input
            type="checkbox"
            checked={isActive}
            onChange={(event) => void handleToggleActive(event.target.checked)}
            className="accent-cyan-400"
            disabled={busy}
          />
          Active in game pickers
        </label>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <label className="grid gap-1 text-xs text-st-muted">
          <span>Name</span>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            className="rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-fg outline-none focus:border-st-accent"
          />
        </label>
        <label className="grid gap-1 text-xs text-st-muted">
          <span>Description</span>
          <input
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            className="rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-fg outline-none focus:border-st-accent"
          />
        </label>
      </div>

      {props.profile.sourceKind === "library" ? (
        <label className="grid gap-1 text-xs text-st-muted">
          <span>Overrides JSON</span>
          <textarea
            value={overridesText}
            onChange={(event) => setOverridesText(event.target.value)}
            rows={8}
            spellCheck={false}
            className="rounded border border-st-border bg-slate-950/60 px-3 py-2 font-mono text-xs text-st-fg outline-none focus:border-st-accent"
            placeholder='{"economy":{"taxRateTarget":0.08}}'
          />
        </label>
      ) : (
        <label className="grid gap-1 text-xs text-st-muted">
          <span>Strategy JSON</span>
          <textarea
            value={strategyText}
            onChange={(event) => setStrategyText(event.target.value)}
            rows={10}
            spellCheck={false}
            className="rounded border border-st-border bg-slate-950/60 px-3 py-2 font-mono text-xs text-st-fg outline-none focus:border-st-accent"
          />
        </label>
      )}

      {status ? <p className="text-sm text-emerald-300">{status}</p> : null}
      {error ? <p className="text-sm text-red-300">{error}</p> : null}

      <div className="flex flex-wrap justify-end gap-2">
        {props.profile.sourceKind === "library" ? (
          <Button type="button" variant="outline" onClick={() => void handleResetLibrary()} disabled={busy}>
            Reset To Library Default
          </Button>
        ) : null}
        <Button type="button" variant="outline" onClick={() => void handleDelete()} disabled={busy}>
          Remove From Roster
        </Button>
        <Button type="button" onClick={() => void handleSave()} disabled={busy}>
          {busy ? "Working..." : "Save Changes"}
        </Button>
      </div>
    </Card>
  );
}

export function StratPage() {
  const publicStrategiesQuery = useQuery(api.usr.queries.listPublicAutomationStrategies, {});
  const profilesQuery = useQuery(api.usr.queries.listMyAutomationProfiles, {});
  const createAutomationProfileFromLibrary = useMutation(
    api.usr.mutations.createAutomationProfileFromLibrary,
  );
  const updateCustomAutomationProfile = useMutation(api.usr.mutations.updateCustomAutomationProfile);
  const updateLibraryAutomationProfile = useMutation(api.usr.mutations.updateLibraryAutomationProfile);
  const setAutomationProfileActive = useMutation(api.usr.mutations.setAutomationProfileActive);
  const deleteMyAutomationProfile = useMutation(api.usr.mutations.deleteMyAutomationProfile);
  const [pageStatus, setPageStatus] = useState<string | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);

  const publicStrategies = (publicStrategiesQuery ?? []) as PublicAutomationStrategyRow[];
  const profiles = (profilesQuery ?? []) as AutomationProfileRow[];
  const activeCount = profiles.filter((profile) => profile.isActive ?? true).length;
  const rosterCountByLibraryKey = useMemo(() => {
    const counts = new Map<string, number>();
    for (const profile of profiles) {
      if (profile.sourceLibraryKey === undefined) {
        continue;
      }
      counts.set(profile.sourceLibraryKey, (counts.get(profile.sourceLibraryKey) ?? 0) + 1);
    }
    return counts;
  }, [profiles]);

  async function addLibraryStrategy(strategy: PublicAutomationStrategyRow) {
    setPageStatus(null);
    setPageError(null);
    await createAutomationProfileFromLibrary({
      libraryKey: strategy.key,
      name: strategy.name,
      description: strategy.description,
      overridesJson: null,
    });
    setPageStatus(`Added ${strategy.name} to your roster.`);
  }

  return (
    <div className="w-full px-4 py-4 sm:px-6">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-4">
        <Card>
          <h1 className="text-sm font-semibold uppercase tracking-wide text-st-muted">Strategies</h1>
          <p className="mt-2 max-w-4xl text-sm text-st-muted">
            Build your personal automation roster from the public library, tune each saved strategy,
            and decide which profiles stay active so only your preferred subset appears quickly in game.
          </p>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <div className="rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-muted">
              Total roster: <span className="font-medium text-st-fg">{profiles.length}</span>
            </div>
            <div className="rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-muted">
              Active in game pickers: <span className="font-medium text-st-fg">{activeCount}</span>
            </div>
            <div className="rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-muted">
              Inactive parked: <span className="font-medium text-st-fg">{profiles.length - activeCount}</span>
            </div>
          </div>
          {pageStatus ? <p className="mt-3 text-sm text-emerald-300">{pageStatus}</p> : null}
          {pageError ? <p className="mt-3 text-sm text-red-300">{pageError}</p> : null}
        </Card>

        <div className="grid gap-4 xl:grid-cols-[1.1fr,0.9fr]">
          <div className="grid gap-3">
            <Card>
              <h2 className="text-sm font-semibold uppercase tracking-wide text-st-muted">Your Roster</h2>
              <p className="mt-2 text-sm text-st-muted">
                Toggle profiles active or inactive, save tuned settings, and reset library branches back to their defaults.
              </p>
            </Card>
            {profilesQuery === undefined ? (
              <Card className="text-sm text-st-muted">Loading your strategy roster...</Card>
            ) : profiles.length === 0 ? (
              <Card className="text-sm text-st-muted">No saved strategies yet. Add one from the public library.</Card>
            ) : (
              profiles.map((profile) => (
                <SavedRosterProfileCard
                  key={profile._id}
                  profile={profile}
                  onToggleActive={async (profileId, isActive) => {
                    await setAutomationProfileActive({ profileId, isActive });
                  }}
                  onSaveLibrary={async (args) => {
                    await updateLibraryAutomationProfile(args);
                  }}
                  onSaveCustom={async (args) => {
                    await updateCustomAutomationProfile(args);
                  }}
                  onResetLibrary={async (profileId, isActive) => {
                    await updateLibraryAutomationProfile({ profileId, overridesJson: null, isActive });
                  }}
                  onDelete={async (profileId) => {
                    await deleteMyAutomationProfile({ profileId });
                  }}
                />
              ))
            )}
          </div>

          <div className="grid gap-3">
            <Card>
              <h2 className="text-sm font-semibold uppercase tracking-wide text-st-muted">Public Library</h2>
              <p className="mt-2 text-sm text-st-muted">
                Add any public strategy to your roster, then branch it with your own saved overrides.
              </p>
            </Card>
            {publicStrategiesQuery === undefined ? (
              <Card className="text-sm text-st-muted">Loading public library...</Card>
            ) : (
              publicStrategies.map((strategy) => (
                <LibraryRosterCard
                  key={strategy.key}
                  strategy={strategy}
                  rosterCount={rosterCountByLibraryKey.get(strategy.key) ?? 0}
                  onAdd={addLibraryStrategy}
                />
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}