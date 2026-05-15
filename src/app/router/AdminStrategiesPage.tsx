import { FormEvent, useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

type StrategyPreview = {
  stance: string;
  earlyRush: boolean;
  reserveShipsPct: number;
  reinforceAttackedSystems: boolean;
} | null;

type StrategyCatalogRow = {
  key: string;
  name: string;
  description: string;
  tags: string[];
  strategyJson: string;
  preview: StrategyPreview;
  availableForHumans: boolean;
  availableForNpcs: boolean;
  createdAt: number;
  updatedAt: number;
};

function mutationErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  return raw.replace(/^[\s\S]*?Error:\s*/g, "").trim() || "Something went wrong.";
}

function formatTimestamp(value: number): string {
  return new Date(value).toLocaleString();
}

function parseTags(text: string): string[] {
  return text
    .split(/[\n,]/)
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0);
}

function formatTags(tags: string[]): string {
  return tags.join(", ");
}

function StrategyCard(props: {
  strategy: StrategyCatalogRow;
  onSave: (args: {
    key: string;
    name: string;
    description: string;
    tags: string[];
    strategyJson: string;
    availableForHumans: boolean;
    availableForNpcs: boolean;
  }) => Promise<void>;
}) {
  const [name, setName] = useState(props.strategy.name);
  const [description, setDescription] = useState(props.strategy.description);
  const [tagsText, setTagsText] = useState(formatTags(props.strategy.tags));
  const [strategyJson, setStrategyJson] = useState(props.strategy.strategyJson);
  const [availableForHumans, setAvailableForHumans] = useState(props.strategy.availableForHumans);
  const [availableForNpcs, setAvailableForNpcs] = useState(props.strategy.availableForNpcs);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    setBusy(true);
    setStatus(null);
    setError(null);
    try {
      await props.onSave({
        key: props.strategy.key,
        name,
        description,
        tags: parseTags(tagsText),
        strategyJson,
        availableForHumans,
        availableForNpcs,
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
            <h3 className="text-sm font-semibold text-st-fg">{props.strategy.name}</h3>
            <span className="rounded border border-st-border px-2 py-0.5 text-xs text-st-muted">
              {props.strategy.key}
            </span>
          </div>
          <p className="mt-1 text-sm text-st-muted">
            Preview: {props.strategy.preview === null ? "No preview available" : `${props.strategy.preview.stance} · ${props.strategy.preview.reserveShipsPct}% reserve`}
          </p>
          <p className="mt-1 text-xs text-st-muted">
            Updated {formatTimestamp(props.strategy.updatedAt)} · Created {formatTimestamp(props.strategy.createdAt)}
          </p>
        </div>
        <div className="flex flex-wrap gap-2 text-xs text-st-muted">
          <span className="rounded border border-st-border px-2 py-0.5">
            Humans {availableForHumans ? "on" : "off"}
          </span>
          <span className="rounded border border-st-border px-2 py-0.5">
            NPCs {availableForNpcs ? "on" : "off"}
          </span>
        </div>
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

      <label className="grid gap-1 text-xs text-st-muted">
        <span>Tags</span>
        <input
          value={tagsText}
          onChange={(event) => setTagsText(event.target.value)}
          placeholder="balanced, expansion, starter"
          className="rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-fg outline-none focus:border-st-accent"
        />
      </label>

      <label className="grid gap-1 text-xs text-st-muted">
        <span>Raw Strategy JSON</span>
        <textarea
          value={strategyJson}
          onChange={(event) => setStrategyJson(event.target.value)}
          rows={12}
          spellCheck={false}
          className="rounded border border-st-border bg-slate-950/60 px-3 py-2 font-mono text-xs text-st-fg outline-none focus:border-st-accent"
        />
      </label>

      <div className="grid gap-2 sm:grid-cols-2">
        <label className="flex items-center gap-2 rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-muted">
          <input
            type="checkbox"
            checked={availableForHumans}
            onChange={(event) => setAvailableForHumans(event.target.checked)}
            className="accent-cyan-400"
          />
          Available to human users
        </label>
        <label className="flex items-center gap-2 rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-muted">
          <input
            type="checkbox"
            checked={availableForNpcs}
            onChange={(event) => setAvailableForNpcs(event.target.checked)}
            className="accent-cyan-400"
          />
          Available to NPC players
        </label>
      </div>

      {status !== null ? <p className="text-sm text-emerald-300">{status}</p> : null}
      {error !== null ? <p className="text-sm text-red-300">{error}</p> : null}

      <div className="flex justify-end">
        <Button type="button" onClick={() => void handleSave()} disabled={busy}>
          {busy ? "Saving..." : "Save strategy"}
        </Button>
      </div>
    </Card>
  );
}

function CreateStrategyCard(props: {
  onCreate: (args: {
    key: string;
    name: string;
    description: string;
    tags: string[];
    strategyJson: string;
    availableForHumans: boolean;
    availableForNpcs: boolean;
  }) => Promise<void>;
}) {
  const [key, setKey] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [tagsText, setTagsText] = useState("");
  const [strategyJson, setStrategyJson] = useState("{}");
  const [availableForHumans, setAvailableForHumans] = useState(true);
  const [availableForNpcs, setAvailableForNpcs] = useState(true);
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
        tags: parseTags(tagsText),
        strategyJson,
        availableForHumans,
        availableForNpcs,
      });
      setKey("");
      setName("");
      setDescription("");
      setTagsText("");
      setStrategyJson("{}");
      setAvailableForHumans(true);
      setAvailableForNpcs(true);
      setStatus("Created strategy.");
    } catch (createError) {
      setError(mutationErrorMessage(createError));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="space-y-4">
      <div>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-st-muted">Create Strategy</h2>
        <p className="mt-1 text-sm text-st-muted">
          Create a new catalog entry. The key is immutable after save, so treat it as the stable slug.
        </p>
      </div>

      <form className="space-y-4" onSubmit={(event) => void handleCreate(event)}>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="grid gap-1 text-xs text-st-muted">
            <span>Key</span>
            <input
              value={key}
              onChange={(event) => setKey(event.target.value)}
              placeholder="balanced-expedition"
              className="rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-fg outline-none focus:border-st-accent"
            />
          </label>
          <label className="grid gap-1 text-xs text-st-muted">
            <span>Name</span>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Balanced Expedition"
              className="rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-fg outline-none focus:border-st-accent"
            />
          </label>
        </div>

        <label className="grid gap-1 text-xs text-st-muted">
          <span>Description</span>
          <input
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Short summary shown in the library"
            className="rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-fg outline-none focus:border-st-accent"
          />
        </label>

        <label className="grid gap-1 text-xs text-st-muted">
          <span>Tags</span>
          <input
            value={tagsText}
            onChange={(event) => setTagsText(event.target.value)}
            placeholder="balanced, expansion, starter"
            className="rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-fg outline-none focus:border-st-accent"
          />
        </label>

        <label className="grid gap-1 text-xs text-st-muted">
          <span>Raw Strategy JSON</span>
          <textarea
            value={strategyJson}
            onChange={(event) => setStrategyJson(event.target.value)}
            rows={12}
            spellCheck={false}
            className="rounded border border-st-border bg-slate-950/60 px-3 py-2 font-mono text-xs text-st-fg outline-none focus:border-st-accent"
          />
        </label>

        <div className="grid gap-2 sm:grid-cols-2">
          <label className="flex items-center gap-2 rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-muted">
            <input
              type="checkbox"
              checked={availableForHumans}
              onChange={(event) => setAvailableForHumans(event.target.checked)}
              className="accent-cyan-400"
            />
            Available to human users
          </label>
          <label className="flex items-center gap-2 rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-muted">
            <input
              type="checkbox"
              checked={availableForNpcs}
              onChange={(event) => setAvailableForNpcs(event.target.checked)}
              className="accent-cyan-400"
            />
            Available to NPC players
          </label>
        </div>

        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-st-muted">Raw JSON is validated and normalized on save.</p>
          <Button type="submit" disabled={busy}>
            {busy ? "Creating..." : "Create strategy"}
          </Button>
        </div>

        {status !== null ? <p className="text-sm text-emerald-300">{status}</p> : null}
        {error !== null ? <p className="text-sm text-red-300">{error}</p> : null}
      </form>
    </Card>
  );
}

export function AdminStrategiesPage() {
  const strategiesQuery = useQuery(api.admin.queries.listAutomationStrategies, {});
  const createAutomationStrategy = useMutation(api.admin.mutations.createAutomationStrategy);
  const updateAutomationStrategy = useMutation(api.admin.mutations.updateAutomationStrategy);
  const seedMissingAutomationStrategies = useMutation(api.admin.mutations.seedMissingAutomationStrategies);

  const strategies = useMemo(() => strategiesQuery?.strategies ?? [], [strategiesQuery]);

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-6">
      <Card className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-st-muted">Admin</p>
        <h1 className="text-2xl font-semibold text-st-fg">Strategies</h1>
        <p className="text-sm text-st-muted">
          Manage the shared automation strategy catalog that powers the public library and NPC helpers.
        </p>
        <p className="text-sm text-st-muted">
          Keys are stable slugs, while the JSON, labels, tags, and availability flags can be edited in place.
        </p>
      </Card>

      {strategiesQuery?.authorized === false ? (
        <Card className="text-sm text-st-muted">Authentication required.</Card>
      ) : (
        <div className="grid gap-4 xl:grid-cols-[0.95fr,1.05fr]">
          <CreateStrategyCard
            onCreate={async (args) => {
              await createAutomationStrategy(args);
            }}
          />

          <Card className="space-y-3">
            <div>
              <h2 className="text-sm font-semibold uppercase tracking-wide text-st-muted">Catalog Summary</h2>
              <p className="mt-1 text-sm text-st-muted">
                {strategiesQuery === undefined
                  ? "Loading catalog..."
                  : `${strategies.length} strategy record${strategies.length === 1 ? "" : "s"} loaded from the database.`}
              </p>
            </div>

            <div className="grid gap-2 sm:grid-cols-2">
              <div className="rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-muted">
                Human-visible: <span className="font-medium text-st-fg">{strategies.filter((strategy) => strategy.availableForHumans).length}</span>
              </div>
              <div className="rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-muted">
                NPC-visible: <span className="font-medium text-st-fg">{strategies.filter((strategy) => strategy.availableForNpcs).length}</span>
              </div>
            </div>

            <p className="text-xs text-st-muted">
              Built-in strategies are seeded from the source library once and then live in this table.
            </p>

            <div className="flex flex-wrap justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => void seedMissingAutomationStrategies()}
              >
                Seed missing built-ins
              </Button>
            </div>
          </Card>
        </div>
      )}

      {strategiesQuery === undefined ? (
        <Card className="text-sm text-st-muted">Loading strategy catalog...</Card>
      ) : strategies.length === 0 ? (
        <Card className="text-sm text-st-muted">
          No strategies are seeded yet. Run the catalog seed mutation after deployment, then refresh this page.
        </Card>
      ) : (
        <div className="space-y-4">
          {strategies.map((strategy) => (
            <StrategyCard
              key={strategy.key}
              strategy={strategy as StrategyCatalogRow}
              onSave={async (args) => {
                await updateAutomationStrategy(args);
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}