import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useActiveGame } from "@/features/galaxy/hooks/useActiveGame";
import {
  formatPopulationPeople,
  formatPopulationPeopleOptional,
} from "@/lib/populationFormat";

function fmt(n: number): string {
  return Math.round(n).toLocaleString();
}

function fmtOptional(n: number | undefined): string {
  if (n === undefined) return "—";
  return fmt(n);
}

export function EconomyScreen() {
  const { games, activeGame, setSelectedGameId } = useActiveGame();
  const setEmpireTaxRate = useMutation(api.eco.mutations.setEmpireTaxRate);

  const snapshot = useQuery(
    api.eco.adminQueries.adminEconomySnapshot,
    activeGame ? { gameId: activeGame._id } : "skip",
  );

  const empires = useMemo(
    () => (snapshot?.kind === "ok" ? snapshot.empires : []),
    [snapshot],
  );
  const systems = useMemo(
    () => (snapshot?.kind === "ok" ? snapshot.systems : []),
    [snapshot],
  );
  const marketSnapshots = useMemo(
    () => (snapshot?.kind === "ok" ? snapshot.marketSnapshots : []),
    [snapshot],
  );

  const [selectedEmpireId, setSelectedEmpireId] = useState<Id<"emp_states"> | null>(
    null,
  );
  const [selectedSystemId, setSelectedSystemId] = useState<Id<"gal_systems"> | null>(
    null,
  );
  /** Local slider value while dragging; cleared after commit so Convex snapshot is source of truth. */
  const [taxSliderDraftPercent, setTaxSliderDraftPercent] = useState<number | null>(null);

  const focusEmpireId = useMemo((): Id<"emp_states"> | null => {
    if (empires.length === 0) return null;
    if (
      selectedEmpireId !== null &&
      empires.some((e) => e._id === selectedEmpireId)
    ) {
      return selectedEmpireId;
    }
    return empires[0]._id;
  }, [empires, selectedEmpireId]);

  const selectedEmpire = useMemo(
    () => (focusEmpireId === null ? null : empires.find((e) => e._id === focusEmpireId) ?? null),
    [empires, focusEmpireId],
  );

  const empireTaxPercentDisplay = useMemo(() => {
    if (selectedEmpire === null) return 5;
    return Math.round((selectedEmpire.empireTaxRate ?? 0.05) * 100);
  }, [selectedEmpire]);

  const taxSliderValue =
    taxSliderDraftPercent !== null ? taxSliderDraftPercent : empireTaxPercentDisplay;

  const canEditEmpireTax =
    snapshot?.kind === "ok" &&
    (snapshot.game.status === "running" || snapshot.game.status === "paused");

  const effectiveSelectedSystemId = useMemo((): Id<"gal_systems"> | null => {
    if (selectedSystemId === null || focusEmpireId === null) return null;
    const row = systems.find((s) => s._id === selectedSystemId);
    if (row === undefined || row.ownerEmpireId !== focusEmpireId) return null;
    return selectedSystemId;
  }, [systems, selectedSystemId, focusEmpireId]);

  const empireSystems = useMemo(() => {
    if (focusEmpireId === null) return [];
    return systems
      .filter((s) => s.ownerEmpireId === focusEmpireId)
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [systems, focusEmpireId]);

  const empireRollups = useMemo(() => {
    let population = 0;
    let stockFood = 0;
    let stockWeapons = 0;
    let stockResearch = 0;
    let idleFleet = 0;
    for (const s of empireSystems) {
      population += s.population ?? 0;
      stockFood += s.stockFood ?? 0;
      stockWeapons += s.stockWeapons ?? 0;
      stockResearch += s.stockResearch ?? 0;
      idleFleet += s.idleFleetStrength;
    }
    return {
      population,
      stockFood,
      stockWeapons,
      stockResearch,
      idleFleet,
      systemCount: empireSystems.length,
    };
  }, [empireSystems]);

  const selectedSystem = useMemo(
    () =>
      effectiveSelectedSystemId === null
        ? null
        : systems.find((s) => s._id === effectiveSelectedSystemId) ?? null,
    [systems, effectiveSelectedSystemId],
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-st-fg">Economy (admin)</h2>
          <p className="mt-1 max-w-xl text-sm text-st-muted">
            Inspect treasury, stockpiles, and per-star production inputs for each empire. Only game
            admins see live data. Population is stored and summed as people (shown compactly as k /
            M / B); under 1,000 people after a turn abandons a colony.
          </p>
        </div>
        <label className="flex min-w-[200px] flex-col gap-1 text-xs text-st-muted">
          Game
          <select
            className="rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-fg"
            value={activeGame?._id ?? ""}
            onChange={(e) => {
              setTaxSliderDraftPercent(null);
              setSelectedGameId(
                e.target.value === ""
                  ? null
                  : (e.target.value as Id<"sim_games">),
              );
            }}
            disabled={games.length === 0}
          >
            {games.length === 0 ? (
              <option value="">No games</option>
            ) : (
              games.map((g) => (
                <option key={g._id} value={g._id}>
                  {g.name} ({g.status})
                </option>
              ))
            )}
          </select>
        </label>
      </div>

      {activeGame === null || games.length === 0 ? (
        <Card>
          <p className="text-sm text-st-muted">
            Create a game from the Galaxy admin panel, then select it here.
          </p>
        </Card>
      ) : snapshot === undefined ? (
        <Card>
          <p className="text-sm text-st-muted">Loading economy data…</p>
        </Card>
      ) : snapshot.kind === "unauthenticated" ? (
        <Card>
          <p className="text-sm text-st-muted">Sign in to view this page.</p>
        </Card>
      ) : snapshot.kind === "forbidden" ? (
        <Card className="border-amber-500/40">
          <p className="text-sm text-st-fg">
            You need the <strong className="font-medium">admin</strong> role on this game to open the
            economy inspector. Empire players should use the Galaxy sidebar for their own snapshot.
          </p>
        </Card>
      ) : snapshot.kind === "not_found" ? (
        <Card>
          <p className="text-sm text-st-muted">Game not found.</p>
        </Card>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3 text-xs text-st-muted">
            <span>
              Turn <strong className="text-st-fg">{snapshot.game.currentTurn}</strong>
            </span>
            <span className="text-st-border">·</span>
            <span>
              Status <strong className="capitalize text-st-fg">{snapshot.game.status}</strong>
            </span>
            <span className="text-st-border">·</span>
            <span>
              Map <strong className="font-mono text-st-fg">{snapshot.game.mapKey}</strong>
            </span>
          </div>

          <Card>
            <label className="block text-xs font-semibold uppercase tracking-wide text-st-muted">
              Empire focus
            </label>
            <select
              className="mt-2 w-full max-w-md rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-fg"
              value={focusEmpireId ?? ""}
              onChange={(e) => {
                setTaxSliderDraftPercent(null);
                setSelectedEmpireId(
                  e.target.value === ""
                    ? null
                    : (e.target.value as Id<"emp_states">),
                );
              }}
            >
              {empires.map((e) => (
                <option key={e._id} value={e._id}>
                  {e.name}
                  {e.isCollapsed ? " (collapsed)" : ""}
                </option>
              ))}
            </select>

            {selectedEmpire !== null ? (
              <>
                <dl className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <div className="rounded border border-st-border bg-st-bg/50 px-3 py-2">
                    <dt className="text-xs text-st-muted">Treasury</dt>
                    <dd className="font-mono text-lg text-st-fg">{fmt(selectedEmpire.treasury)}</dd>
                  </div>
                  <div className="rounded border border-st-border bg-st-bg/50 px-3 py-2">
                    <dt className="text-xs text-st-muted">Population (cached, people)</dt>
                    <dd className="font-mono text-lg text-st-fg">
                      {formatPopulationPeople(selectedEmpire.population)}
                    </dd>
                  </div>
                  <div className="rounded border border-st-border bg-st-bg/50 px-3 py-2">
                    <dt className="text-xs text-st-muted">Research pool</dt>
                    <dd className="font-mono text-lg text-st-fg">
                      {fmtOptional(selectedEmpire.researchPool)}
                    </dd>
                  </div>
                  <div className="rounded border border-st-border bg-st-bg/50 px-3 py-2">
                    <dt className="text-xs text-st-muted">Insolvency streak</dt>
                    <dd className="font-mono text-lg text-st-fg">
                      {selectedEmpire.insolvencyTurns ?? 0} turns
                    </dd>
                  </div>
                </dl>
                <div className="mt-4 rounded border border-st-border bg-st-bg/50 px-3 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <label
                      htmlFor="empire-tax-slider"
                      className="text-xs font-semibold uppercase tracking-wide text-st-muted"
                    >
                      Empire-wide tax
                    </label>
                    <span className="font-mono text-sm text-st-fg">{taxSliderValue}%</span>
                  </div>
                  <input
                    id="empire-tax-slider"
                    type="range"
                    min={0}
                    max={30}
                    step={1}
                    className="mt-2 w-full max-w-md accent-st-fg disabled:opacity-50"
                    value={taxSliderValue}
                    disabled={
                      selectedEmpire.isCollapsed ||
                      !canEditEmpireTax ||
                      activeGame === null
                    }
                    onChange={(e) =>
                      setTaxSliderDraftPercent(Number(e.target.value))
                    }
                    onPointerUp={() => {
                      if (
                        activeGame === null ||
                        selectedEmpire.isCollapsed ||
                        !canEditEmpireTax
                      ) {
                        return;
                      }
                      void setEmpireTaxRate({
                        gameId: activeGame._id,
                        empireId: selectedEmpire._id,
                        taxPercent: taxSliderValue,
                      }).then(() => setTaxSliderDraftPercent(null));
                    }}
                  />
                  <p className="mt-2 max-w-xl text-[11px] leading-snug text-st-muted">
                    Applies to all stars this empire controls on the next processed turn: higher tax
                    increases population-based treasury income and reduces local food, ships, and
                    research output. Default is 5%.
                  </p>
                  {!canEditEmpireTax ? (
                    <p className="mt-1 text-[11px] text-amber-500/90">
                      Editing tax requires the game to be running or paused.
                    </p>
                  ) : null}
                </div>
              </>
            ) : null}

            {selectedEmpire !== null ? (
              <div className="mt-4 rounded border border-st-border/80 bg-st-panel/40 px-3 py-3">
                <div className="text-xs font-semibold uppercase tracking-wide text-st-muted">
                  Rolled up from owned stars
                </div>
                <dl className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-6">
                  <div>
                    <dt className="text-[11px] text-st-muted">Stars owned</dt>
                    <dd className="font-mono text-st-fg">{empireRollups.systemCount}</dd>
                  </div>
                  <div>
                    <dt className="text-[11px] text-st-muted">Σ Population (people)</dt>
                    <dd className="font-mono text-st-fg">
                      {formatPopulationPeople(empireRollups.population)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[11px] text-st-muted">Σ Food stock</dt>
                    <dd className="font-mono text-st-fg">{fmt(empireRollups.stockFood)}</dd>
                  </div>
                  <div>
                    <dt className="text-[11px] text-st-muted">Σ Weapons stock</dt>
                    <dd className="font-mono text-st-fg">{fmt(empireRollups.stockWeapons)}</dd>
                  </div>
                  <div>
                    <dt className="text-[11px] text-st-muted">Σ Research stock</dt>
                    <dd className="font-mono text-st-fg">{fmt(empireRollups.stockResearch)}</dd>
                  </div>
                  <div>
                    <dt className="text-[11px] text-st-muted">Σ Idle fleet ships</dt>
                    <dd className="font-mono text-st-fg">{fmt(empireRollups.idleFleet)}</dd>
                  </div>
                </dl>
              </div>
            ) : null}
          </Card>

          {marketSnapshots.length > 0 ? (
            <Card>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-st-muted">
                Market (current turn)
              </h3>
              <ul className="mt-2 flex flex-wrap gap-3 text-sm">
                {marketSnapshots.map((row) => (
                  <li
                    key={row.commodity}
                    className="rounded border border-st-border px-2 py-1 font-mono text-xs"
                  >
                    <span className="text-st-muted">{row.commodity}</span>{" "}
                    <span className="text-st-fg">{row.unitPrice.toFixed(2)}</span>
                    <span className="text-st-muted"> vol {fmt(row.volume)}</span>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}

          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(280px,400px)]">
            <Card>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-st-muted">
                Stars ({selectedEmpire?.name ?? "—"})
              </h3>
              {empireSystems.length === 0 ? (
                <p className="mt-3 text-sm text-st-muted">No systems owned by this empire.</p>
              ) : (
                <div className="mt-3 overflow-x-auto">
                  <table className="w-full min-w-[520px] border-collapse text-left text-sm">
                    <thead>
                      <tr className="border-b border-st-border text-xs uppercase text-st-muted">
                        <th className="py-2 pr-2 font-medium">System</th>
                        <th className="py-2 pr-2 font-medium text-right">Pop (ppl)</th>
                        <th className="py-2 pr-2 font-medium text-right">Food</th>
                        <th className="py-2 pr-2 font-medium text-right">Wpn</th>
                        <th className="py-2 pr-2 font-medium text-right">Res</th>
                        <th className="py-2 font-medium text-right">Idle ships</th>
                      </tr>
                    </thead>
                    <tbody>
                      {empireSystems.map((row) => {
                        const isSelected = effectiveSelectedSystemId === row._id;
                        return (
                          <tr
                            key={row._id}
                            className={`cursor-pointer border-b border-st-border/60 transition-colors ${
                              isSelected ? "bg-st-accent/15" : "hover:bg-st-bg/80"
                            }`}
                            onClick={() => setSelectedSystemId(row._id)}
                          >
                            <td className="py-2 pr-2 font-medium text-st-fg">{row.name}</td>
                            <td className="py-2 pr-2 text-right font-mono text-st-fg">
                              {formatPopulationPeopleOptional(row.population)}
                            </td>
                            <td className="py-2 pr-2 text-right font-mono text-st-fg">
                              {fmtOptional(row.stockFood)}
                            </td>
                            <td className="py-2 pr-2 text-right font-mono text-st-fg">
                              {fmtOptional(row.stockWeapons)}
                            </td>
                            <td className="py-2 pr-2 text-right font-mono text-st-fg">
                              {fmtOptional(row.stockResearch)}
                            </td>
                            <td className="py-2 text-right font-mono text-st-fg">
                              {fmt(row.idleFleetStrength)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
              <p className="mt-3 text-[11px] text-st-muted">
                Click a row to inspect full system economy fields.
              </p>
            </Card>

            <Card className="lg:sticky lg:top-4 lg:self-start">
              <div className="flex items-start justify-between gap-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-st-muted">
                  System detail
                </h3>
                {selectedSystem !== null ? (
                  <Button
                    type="button"
                    variant="ghost"
                    className="h-auto px-2 py-0.5 text-xs"
                    onClick={() => setSelectedSystemId(null)}
                  >
                    Clear
                  </Button>
                ) : null}
              </div>

              {selectedSystem === null ? (
                <p className="mt-4 text-sm text-st-muted">
                  Select a star from the table to view stockpiles, emphasis, tax flags, and holding
                  modifiers.
                </p>
              ) : (
                <dl className="mt-4 space-y-3 text-sm">
                  <div>
                    <dt className="text-xs text-st-muted">Name</dt>
                    <dd className="font-medium text-st-fg">{selectedSystem.name}</dd>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <dt className="text-xs text-st-muted">Key</dt>
                      <dd className="font-mono text-xs text-st-fg">{selectedSystem.systemKey}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-st-muted">Homeworld</dt>
                      <dd className="text-st-fg">{selectedSystem.isHomeworld ? "Yes" : "No"}</dd>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <dt className="text-xs text-st-muted">Base productivity</dt>
                      <dd className="font-mono text-st-fg">
                        {selectedSystem.baseProductivity ?? "—"}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-st-muted">Resource richness</dt>
                      <dd className="font-mono text-st-fg">
                        {(selectedSystem.resourceRichness * 100).toFixed(0)}%
                      </dd>
                    </div>
                  </div>
                  <div>
                    <dt className="text-xs text-st-muted">Stockpiles</dt>
                    <dd className="mt-1 grid grid-cols-2 gap-x-2 gap-y-1 font-mono text-xs">
                      <span className="text-st-muted">Food</span>
                      <span className="text-right text-st-fg">
                        {fmtOptional(selectedSystem.stockFood)}
                      </span>
                      <span className="text-st-muted">Weapons</span>
                      <span className="text-right text-st-fg">
                        {fmtOptional(selectedSystem.stockWeapons)}
                      </span>
                      <span className="text-st-muted">Research</span>
                      <span className="text-right text-st-fg">
                        {fmtOptional(selectedSystem.stockResearch)}
                      </span>
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-st-muted">Population (people)</dt>
                    <dd className="font-mono text-st-fg">
                      {formatPopulationPeopleOptional(selectedSystem.population)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-st-muted">Emphasis (food / ships / research)</dt>
                    <dd className="font-mono text-xs text-st-fg">
                      {selectedSystem.emphasisFood ?? "—"} / {selectedSystem.emphasisShips ?? "—"} /{" "}
                      {selectedSystem.emphasisResearch ?? "—"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-st-muted">Idle fleet at star</dt>
                    <dd className="font-mono text-st-fg">{fmt(selectedSystem.idleFleetStrength)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-st-muted">Tax & combat flags</dt>
                    <dd className="mt-1 space-y-1 text-xs">
                      <div className="flex justify-between gap-2">
                        <span className="text-st-muted">Tax blocked until turn</span>
                        <span className="font-mono text-st-fg">
                          {selectedSystem.taxBlockedUntilTurn ?? "—"}
                        </span>
                      </div>
                      <div className="flex justify-between gap-2">
                        <span className="text-st-muted">Last contested turn</span>
                        <span className="font-mono text-st-fg">
                          {selectedSystem.lastContestedTurn ?? "—"}
                        </span>
                      </div>
                      <div className="flex justify-between gap-2">
                        <span className="text-st-muted">Under attack (last combat)</span>
                        <span className="text-st-fg">
                          {selectedSystem.underAttack ? "Yes" : "No"}
                        </span>
                      </div>
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-st-muted">Recent battle damage (markers)</dt>
                    <dd className="mt-1 grid grid-cols-2 gap-x-2 font-mono text-[11px]">
                      <span className="text-st-muted">Food</span>
                      <span className="text-right">{fmtOptional(selectedSystem.recentDamageFood)}</span>
                      <span className="text-st-muted">Weapons</span>
                      <span className="text-right">
                        {fmtOptional(selectedSystem.recentDamageWeapons)}
                      </span>
                      <span className="text-st-muted">Research</span>
                      <span className="text-right">
                        {fmtOptional(selectedSystem.recentDamageResearch)}
                      </span>
                      <span className="text-st-muted">Population</span>
                      <span className="text-right">
                        {fmtOptional(selectedSystem.recentDamagePopulation)}
                      </span>
                      <span className="text-st-muted">Battle turns left</span>
                      <span className="text-right">
                        {fmtOptional(selectedSystem.recentBattleTurns)}
                      </span>
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-st-muted">Independent treasury</dt>
                    <dd className="font-mono text-st-fg">
                      {selectedSystem.localTreasury !== undefined
                        ? fmt(selectedSystem.localTreasury)
                        : "—"}
                    </dd>
                  </div>
                  {selectedSystem.holding !== null ? (
                    <div>
                      <dt className="text-xs text-st-muted">Holding (tax / production / unrest)</dt>
                      <dd className="mt-1 space-y-1 font-mono text-xs">
                        <p className="text-[10px] leading-snug text-st-muted">
                          Live tax is empire-wide (see slider above).{" "}
                          <span className="font-mono text-st-fg">
                            Policy {Math.round((selectedEmpire?.empireTaxRate ?? 0.05) * 100)}%
                          </span>
                          ; holding taxRate below is legacy and not used in the sim.
                        </p>
                        <div className="flex justify-between">
                          <span className="text-st-muted">Holding taxRate (legacy)</span>
                          <span className="text-st-fg">{selectedSystem.holding.taxRate}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-st-muted">Production mod</span>
                          <span className="text-st-fg">{selectedSystem.holding.productionModifier}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-st-muted">Unrest</span>
                          <span className="text-st-fg">{selectedSystem.holding.unrest}</span>
                        </div>
                      </dd>
                    </div>
                  ) : (
                    <p className="text-xs text-st-muted">No emp_system_holdings row for this star.</p>
                  )}
                </dl>
              )}
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
