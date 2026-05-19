import { FormEvent, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../../../convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { StaticGalaxyMapPreview } from "@/features/galaxy/components/StaticGalaxyMapPreview";
import type { MapCatalogRow } from "../../../convex/sim/mapCatalog";
import { mutationErrorMessage } from "./adminMissionsShared";

type MapDraft = {
  key: string;
  name: string;
  description: string;
  tier: MapCatalogRow["tier"];
  sortOrder: string;
};

const EMPTY_DRAFT: MapDraft = {
  key: "",
  name: "",
  description: "",
  tier: "small",
  sortOrder: "100",
};

function draftFromMap(map: MapCatalogRow): MapDraft {
  return {
    key: map.key,
    name: map.name,
    description: map.description,
    tier: map.tier,
    sortOrder: String(map.sortOrder),
  };
}

function mapOrder(left: MapCatalogRow, right: MapCatalogRow): number {
  return left.sortOrder - right.sortOrder || left.name.localeCompare(right.name);
}

function tierTone(tier: MapCatalogRow["tier"]): string {
  switch (tier) {
    case "small":
      return "border-sky-500/40 bg-sky-950/30 text-sky-200";
    case "medium":
      return "border-amber-500/40 bg-amber-950/30 text-amber-200";
    case "large":
      return "border-violet-500/40 bg-violet-950/30 text-violet-200";
    default:
      return "border-st-border text-st-muted";
  }
}

export function AdminMapsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const mapsQuery = useQuery(api.admin.queries.listMapRecords, {});
  const seedMissingMaps = useMutation(api.admin.mutations.seedMissingMaps);
  const createMap = useMutation(api.admin.mutations.createMap);
  const updateMap = useMutation(api.admin.mutations.updateMap);

  const maps = useMemo(
    () => (mapsQuery?.authorized ? [...(mapsQuery.maps as MapCatalogRow[])].sort(mapOrder) : []),
    [mapsQuery],
  );
  const selectedKey = searchParams.get("map")?.trim() || "";
  const selectedMap = useMemo(
    () => maps.find((map) => map.key === selectedKey) ?? null,
    [maps, selectedKey],
  );

  const [draft, setDraft] = useState<MapDraft>(EMPTY_DRAFT);
  const [busy, setBusy] = useState(false);
  const [seedBusy, setSeedBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDraft(selectedMap === null ? EMPTY_DRAFT : draftFromMap(selectedMap));
  }, [selectedMap?.key]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setStatus(null);
    setError(null);

    try {
      if (selectedMap === null) {
        const result = await createMap({
          key: draft.key,
          name: draft.name,
          description: draft.description,
          tier: draft.tier,
          sortOrder: Number(draft.sortOrder),
        });
        setSearchParams({ map: result.key }, { replace: true });
        setStatus(`Created ${result.key}.`);
      } else {
        await updateMap({
          key: selectedMap.key,
          name: draft.name,
          description: draft.description,
          tier: draft.tier,
          sortOrder: Number(draft.sortOrder),
        });
        setStatus(`Saved ${selectedMap.key}.`);
      }
    } catch (submitError) {
      setError(mutationErrorMessage(submitError));
    } finally {
      setBusy(false);
    }
  }

  async function handleSeedBuiltIns() {
    setSeedBusy(true);
    setStatus(null);
    setError(null);
    try {
      const result = await seedMissingMaps({});
      setStatus(`Synced ${result.inserted} inserted and ${result.updated} updated built-in maps.`);
    } catch (seedError) {
      setError(mutationErrorMessage(seedError));
    } finally {
      setSeedBusy(false);
    }
  }

  if (mapsQuery === undefined) {
    return (
      <div className="mx-auto max-w-[86.4rem] px-4 py-6">
        <Card className="text-sm text-st-muted">Loading...</Card>
      </div>
    );
  }

  if (!mapsQuery.authorized) {
    return (
      <div className="mx-auto max-w-[86.4rem] px-4 py-6">
        <Card className="space-y-3 text-sm text-st-muted">
          <p>Sign in with an admin account to manage maps.</p>
          <Button asChild variant="outline">
            <Link to="/admin">Back to Admin</Link>
          </Button>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[86.4rem] space-y-6 px-4 py-6">
      <Card className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-st-muted">Admin · Maps</p>
        <h1 className="text-2xl font-semibold text-st-fg">Galaxy maps</h1>
        <p className="max-w-3xl text-sm text-st-muted">
          Manage the map catalog stored in <span className="font-mono text-st-fg">sim_maps</span>. Click a map to preview its record, then edit the metadata on the right.
        </p>
      </Card>

      <div className="grid gap-6 xl:grid-cols-[22rem_minmax(0,1fr)]">
        <Card className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-st-fg">Map records</h2>
              <p className="text-sm text-st-muted">{maps.length} record{maps.length === 1 ? "" : "s"}</p>
            </div>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setStatus(null);
                  setError(null);
                  setSearchParams({}, { replace: true });
                }}
              >
                New map
              </Button>
              <Button type="button" variant="secondary" onClick={() => void handleSeedBuiltIns()} disabled={seedBusy}>
                {seedBusy ? "Syncing..." : "Sync built-ins"}
              </Button>
            </div>
          </div>

          {maps.length === 0 ? (
            <div className="rounded-xl border border-dashed border-st-border bg-st-bg/50 px-4 py-5 text-sm text-st-muted">
              No maps have been created yet. Use the form on the right to add the first record.
            </div>
          ) : (
            <div className="grid gap-3">
              {maps.map((map) => {
                const isSelected = map.key === selectedMap?.key;
                return (
                  <button
                    key={map.key}
                    type="button"
                    onClick={() => {
                      setStatus(null);
                      setError(null);
                      setSearchParams({ map: map.key }, { replace: true });
                    }}
                    className={`rounded-xl border px-4 py-4 text-left transition-colors ${isSelected ? "border-st-accent bg-st-bg" : "border-st-border bg-st-panel hover:border-st-accent/60 hover:bg-st-bg"}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-sm font-semibold text-st-fg">{map.name}</div>
                        <div className="mt-1 font-mono text-xs text-st-muted">{map.key}</div>
                      </div>
                      <span className={`rounded border px-2 py-0.5 text-[11px] uppercase tracking-[0.18em] ${tierTone(map.tier)}`}>
                        {map.tier}
                      </span>
                    </div>
                    <p className="mt-3 line-clamp-3 text-sm text-st-muted">{map.description}</p>
                    <p className="mt-3 text-xs text-st-muted">Sort order {map.sortOrder}</p>
                  </button>
                );
              })}
            </div>
          )}
        </Card>

        <Card className="space-y-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-st-muted">
                {selectedMap === null ? "Create" : "Preview"}
              </p>
              <h2 className="text-xl font-semibold text-st-fg">
                {selectedMap === null ? "New map" : selectedMap.name}
              </h2>
              <p className="mt-1 text-sm text-st-muted">
                {selectedMap === null
                  ? "Fill out a new catalog entry, then save it to sim_maps."
                  : "Selected record preview. Editing the fields below updates the catalog row."}
              </p>
            </div>
            {selectedMap !== null ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setStatus(null);
                  setError(null);
                  setSearchParams({}, { replace: true });
                }}
              >
                Create new
              </Button>
            ) : null}
          </div>

          {selectedMap !== null ? (
            <div className="space-y-4 rounded-xl border border-st-border bg-st-bg/50 p-4">
              <StaticGalaxyMapPreview map={selectedMap} />
              <div className="grid gap-3 md:grid-cols-2">
                <div>
                  <p className="text-xs uppercase tracking-[0.18em] text-st-muted">Key</p>
                  <p className="mt-1 font-mono text-sm text-st-fg">{selectedMap.key}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-[0.18em] text-st-muted">Tier</p>
                  <p className={`mt-1 inline-flex rounded border px-2 py-0.5 text-[11px] uppercase tracking-[0.18em] ${tierTone(selectedMap.tier)}`}>
                    {selectedMap.tier}
                  </p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-[0.18em] text-st-muted">Sort order</p>
                  <p className="mt-1 text-sm text-st-fg">{selectedMap.sortOrder}</p>
                </div>
                <div className="md:col-span-2">
                  <p className="text-xs uppercase tracking-[0.18em] text-st-muted">Description</p>
                  <p className="mt-1 text-sm text-st-muted">{selectedMap.description}</p>
                </div>
                <div className="md:col-span-2">
                  <p className="text-xs uppercase tracking-[0.18em] text-st-muted">Definition JSON</p>
                  <textarea
                    readOnly
                    value={selectedMap.definitionJson ?? (selectedMap.definition === null || selectedMap.definition === undefined ? "" : JSON.stringify(selectedMap.definition, null, 2))}
                    rows={8}
                    className="mt-1 w-full rounded border border-st-border bg-st-panel px-3 py-2 font-mono text-xs text-st-fg outline-none"
                    placeholder="No definition JSON stored for this map yet."
                  />
                </div>
              </div>
            </div>
          ) : null}

          <form className="space-y-4" onSubmit={(event) => void handleSubmit(event)}>
            <div className="grid gap-3 md:grid-cols-2">
              <label className="grid gap-1 text-xs text-st-muted">
                <span>Key</span>
                <input
                  value={draft.key}
                  onChange={(event) => setDraft((current) => ({ ...current, key: event.target.value }))}
                  disabled={selectedMap !== null}
                  placeholder="v1-custom"
                  className="rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-fg outline-none focus:border-st-accent disabled:opacity-60"
                />
              </label>
              <label className="grid gap-1 text-xs text-st-muted">
                <span>Name</span>
                <input
                  value={draft.name}
                  onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
                  placeholder="Frontier Ring"
                  className="rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-fg outline-none focus:border-st-accent"
                />
              </label>
              <label className="grid gap-1 text-xs text-st-muted md:col-span-2">
                <span>Description</span>
                <textarea
                  value={draft.description}
                  onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))}
                  rows={5}
                  placeholder="What makes this layout distinct?"
                  className="rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-fg outline-none focus:border-st-accent"
                />
              </label>
              <label className="grid gap-1 text-xs text-st-muted">
                <span>Tier</span>
                <select
                  value={draft.tier}
                  onChange={(event) => setDraft((current) => ({ ...current, tier: event.target.value as MapCatalogRow["tier"] }))}
                  className="rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-fg outline-none focus:border-st-accent"
                >
                  <option value="small">small</option>
                  <option value="medium">medium</option>
                  <option value="large">large</option>
                </select>
              </label>
              <label className="grid gap-1 text-xs text-st-muted">
                <span>Sort order</span>
                <input
                  type="number"
                  step={1}
                  min={0}
                  value={draft.sortOrder}
                  onChange={(event) => setDraft((current) => ({ ...current, sortOrder: event.target.value }))}
                  className="rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-fg outline-none focus:border-st-accent"
                />
              </label>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <Button type="submit" disabled={busy}>
                {busy ? "Saving..." : selectedMap === null ? "Create map" : "Save map"}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setStatus(null);
                  setError(null);
                  setSearchParams({}, { replace: true });
                  setDraft(EMPTY_DRAFT);
                }}
              >
                Reset
              </Button>
              {status !== null ? <p className="text-sm text-emerald-300">{status}</p> : null}
              {error !== null ? <p className="text-sm text-rose-300">{error}</p> : null}
            </div>
          </form>
        </Card>
      </div>
    </div>
  );
}