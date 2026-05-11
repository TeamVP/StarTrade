import { useState, useMemo } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useActiveGame } from "@/features/galaxy/hooks/useActiveGame";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtCredits(n: number): string {
  return `${Math.round(n).toLocaleString()} cr`;
}

function fmtUnits(n: number): string {
  return n.toLocaleString();
}

function StatusBadge({ status }: { status: string }) {
  const classes =
    status === "enRoute"
      ? "bg-sky-500/15 text-sky-300 ring-1 ring-sky-500/30"
      : status === "delivered"
        ? "bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/30"
        : "bg-st-border/40 text-st-muted ring-1 ring-st-border";
  const label =
    status === "enRoute" ? "En Route" : status === "delivered" ? "Delivered" : "Cancelled";
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${classes}`}>
      {label}
    </span>
  );
}

// ─── Trader card ──────────────────────────────────────────────────────────────

type EnrichedTrader = {
  _id: Id<"eco_bg_traders">;
  status: "enRoute" | "delivered" | "cancelled";
  commodity: string;
  cargoUnits: number;
  boughtAtPrice: number;
  travelTurns: number;
  etaTurn: number;
  dispatchedTurn: number;
  shipHireCostPerTurn: number;
  originSystemId: Id<"gal_systems">;
  destinationSystemId: Id<"gal_systems">;
  originName: string;
  destName: string;
  turnsRemaining: number;
  totalShipCost: number;
  captainDisplayName?: string | null;
  captainAffiliation?: string | null;
  operatorKind?: "npc" | "player" | "unknown";
};

function TraderCard({
  trader,
  currentTurn,
}: {
  trader: EnrichedTrader;
  currentTurn: number;
}) {
  const turnsLeft = Math.max(0, trader.etaTurn - currentTurn);
  const totalCost = trader.totalShipCost + 20; // 20 = BG_TRADER_DOCKING_COST
  const revenue = trader.cargoUnits * trader.boughtAtPrice; // notional buy cost
  const progressPct =
    trader.travelTurns > 0
      ? Math.min(100, ((trader.travelTurns - turnsLeft) / trader.travelTurns) * 100)
      : 100;

  return (
      <div className="rounded-lg border border-st-border bg-st-bg p-4 space-y-3">
      {/* Route header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          {trader.captainDisplayName ? (
            <div className="mb-1">
              <p className="font-semibold text-st-fg leading-tight">{trader.captainDisplayName}</p>
              {trader.captainAffiliation ? (
                <p className="text-[11px] text-st-muted leading-snug">{trader.captainAffiliation}</p>
              ) : null}
              <p className="text-[10px] text-st-muted/80 mt-0.5">
                {trader.operatorKind === "player"
                  ? "Player trader"
                  : trader.operatorKind === "npc"
                    ? "NPC trader"
                    : "Trader"}
              </p>
            </div>
          ) : null}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-st-fg">{trader.originName}</span>
            <span className="text-st-muted text-sm">→</span>
            <span className="font-semibold text-st-fg">{trader.destName}</span>
            <StatusBadge status={trader.status} />
          </div>
          <p className="text-xs text-st-muted mt-0.5">
            Dispatched turn {trader.dispatchedTurn} · ETA turn {trader.etaTurn}
          </p>
        </div>
        <div className="text-right shrink-0">
          <p className="text-lg font-bold text-amber-400 tabular-nums">
            {fmtUnits(trader.cargoUnits)}
          </p>
          <p className="text-[10px] text-st-muted uppercase tracking-wide">{trader.commodity}</p>
        </div>
      </div>

      {/* Progress bar (only for enRoute) */}
      {trader.status === "enRoute" && (
        <div className="space-y-1">
          <div className="flex justify-between text-[10px] text-st-muted">
            <span>{turnsLeft} turn{turnsLeft !== 1 ? "s" : ""} remaining</span>
            <span>{Math.round(progressPct)}% complete</span>
          </div>
          <div className="h-1.5 rounded-full bg-st-border overflow-hidden">
            <div
              className="h-full rounded-full bg-sky-500 transition-all"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>
      )}

      {/* Cost breakdown */}
      <div className="grid grid-cols-3 gap-2 text-xs">
        <div className="rounded bg-st-panel px-2 py-1.5 space-y-0.5">
          <p className="text-st-muted uppercase tracking-wide text-[9px]">Cargo value</p>
          <p className="font-semibold tabular-nums">{fmtCredits(revenue)}</p>
        </div>
        <div className="rounded bg-st-panel px-2 py-1.5 space-y-0.5">
          <p className="text-st-muted uppercase tracking-wide text-[9px]">Ship hire</p>
          <p className="font-semibold tabular-nums">{fmtCredits(trader.totalShipCost)}</p>
          <p className="text-[9px] text-st-muted">{fmtCredits(trader.shipHireCostPerTurn)}/turn × {trader.travelTurns}</p>
        </div>
        <div className="rounded bg-st-panel px-2 py-1.5 space-y-0.5">
          <p className="text-st-muted uppercase tracking-wide text-[9px]">Total cost</p>
          <p className="font-semibold tabular-nums">{fmtCredits(totalCost)}</p>
          <p className="text-[9px] text-st-muted">+20 cr docking</p>
        </div>
      </div>
    </div>
  );
}

// ─── Spawn form ───────────────────────────────────────────────────────────────

type SystemInfo = {
  _id: Id<"gal_systems">;
  name: string;
  ownerEmpireId: Id<"emp_states"> | null;
  foodPrice: number | undefined;
  stockFood: number | undefined;
};

function SpawnTraderForm({
  gameId,
  systems,
}: {
  gameId: Id<"sim_games">;
  systems: SystemInfo[];
}) {
  const spawnTrader = useMutation(api.eco.mutations.spawnTrader);

  const [originId, setOriginId] = useState<Id<"gal_systems"> | "">("");
  const [destId, setDestId] = useState<Id<"gal_systems"> | "">("");
  const [commodity, setCommodity] = useState("food");
  const [cargoUnits, setCargoUnits] = useState(100);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<{
    etaTurn: number;
    travelTurns: number;
    profitabilityRatio: number;
    profitabilityWarning: string | null;
  } | null>(null);

  const sortedSystems = useMemo(
    () => [...systems].sort((a, b) => a.name.localeCompare(b.name)),
    [systems],
  );

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!originId || !destId) return;
    setError(null);
    setLastResult(null);
    setBusy(true);
    try {
      const result = await spawnTrader({
        gameId,
        originSystemId: originId as Id<"gal_systems">,
        destinationSystemId: destId as Id<"gal_systems">,
        commodity,
        cargoUnits,
      });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setLastResult({
        etaTurn: result.etaTurn,
        travelTurns: result.travelTurns,
        profitabilityRatio: result.profitabilityRatio,
        profitabilityWarning: result.profitabilityWarning,
      });
      setOriginId("");
      setDestId("");
      setCargoUnits(100);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to spawn trader.");
    } finally {
      setBusy(false);
    }
  }

  const originSystem = systems.find((s) => s._id === originId);
  const destSystem = systems.find((s) => s._id === destId);

  return (
    <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {/* Origin */}
        <div className="space-y-1">
          <label className="text-xs font-medium text-st-muted">Origin System</label>
          <select
            value={originId}
            onChange={(e) => setOriginId(e.target.value as Id<"gal_systems"> | "")}
            className="w-full rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-fg"
            required
          >
            <option value="">— pick origin —</option>
            {sortedSystems.map((s) => (
              <option key={s._id} value={s._id}>
                {s.name}
                {s.foodPrice !== undefined ? ` (${s.foodPrice.toFixed(1)} cr)` : ""}
              </option>
            ))}
          </select>
          {originSystem && (
            <p className="text-[10px] text-st-muted">
              Stock food: {(originSystem.stockFood ?? 0).toLocaleString()} ·
              Price: {originSystem.foodPrice?.toFixed(1) ?? "—"} cr
            </p>
          )}
        </div>

        {/* Destination */}
        <div className="space-y-1">
          <label className="text-xs font-medium text-st-muted">Destination System</label>
          <select
            value={destId}
            onChange={(e) => setDestId(e.target.value as Id<"gal_systems"> | "")}
            className="w-full rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-fg"
            required
          >
            <option value="">— pick destination —</option>
            {sortedSystems
              .filter((s) => s._id !== originId)
              .map((s) => (
                <option key={s._id} value={s._id}>
                  {s.name}
                  {s.foodPrice !== undefined ? ` (${s.foodPrice.toFixed(1)} cr)` : ""}
                </option>
              ))}
          </select>
          {destSystem && (
            <p className="text-[10px] text-st-muted">
              Stock food: {(destSystem.stockFood ?? 0).toLocaleString()} ·
              Price: {destSystem.foodPrice?.toFixed(1) ?? "—"} cr
            </p>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {/* Commodity */}
        <div className="space-y-1">
          <label className="text-xs font-medium text-st-muted">Commodity</label>
          <select
            value={commodity}
            onChange={(e) => setCommodity(e.target.value)}
            className="w-full rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-fg"
          >
            <option value="food">Food</option>
            <option value="weapons">Weapons</option>
            <option value="heavy_metals">Heavy Metals</option>
          </select>
        </div>

        {/* Cargo */}
        <div className="space-y-1">
          <label className="text-xs font-medium text-st-muted">
            Cargo Units
            <span className="ml-2 font-normal text-st-muted">({cargoUnits.toLocaleString()})</span>
          </label>
          <input
            type="range"
            min={10}
            max={1000}
            step={10}
            value={cargoUnits}
            onChange={(e) => setCargoUnits(parseInt(e.target.value, 10))}
            className="w-full h-2 accent-st-accent cursor-pointer"
          />
          <div className="flex justify-between text-[10px] text-st-muted">
            <span>10</span>
            <span>1,000</span>
          </div>
        </div>
      </div>

      {originSystem && destSystem && originSystem.foodPrice !== undefined && destSystem.foodPrice !== undefined && (
        <div className="rounded bg-st-panel px-3 py-2 text-xs space-y-1">
          <p className="font-medium text-st-fg">Price signal</p>
          <p className="text-st-muted">
            Buy at <span className="text-st-fg font-mono">{originSystem.foodPrice.toFixed(1)} cr</span> ·
            Sell at <span className="text-st-fg font-mono">{destSystem.foodPrice.toFixed(1)} cr</span> ·
            Spread{" "}
            <span
              className={
                destSystem.foodPrice - originSystem.foodPrice > 0
                  ? "text-emerald-400 font-mono"
                  : "text-red-400 font-mono"
              }
            >
              {(destSystem.foodPrice - originSystem.foodPrice).toFixed(1)} cr/unit
            </span>
          </p>
        </div>
      )}

      {error !== null && (
        <p className="rounded bg-red-500/10 px-3 py-2 text-sm text-red-400 ring-1 ring-red-500/30">
          {error}
        </p>
      )}

      {lastResult !== null && (
        <div className="space-y-2">
          <p className="rounded bg-emerald-500/10 px-3 py-2 text-sm text-emerald-400 ring-1 ring-emerald-500/30">
            Trader spawned — {lastResult.travelTurns} turn voyage, ETA turn {lastResult.etaTurn}.
            Profit signal ≈ {lastResult.profitabilityRatio.toFixed(2)}× expected cost.
          </p>
          {lastResult.profitabilityWarning !== null && (
            <p className="rounded bg-amber-500/10 px-3 py-2 text-sm text-amber-300 ring-1 ring-amber-500/30">
              {lastResult.profitabilityWarning}
            </p>
          )}
        </div>
      )}

      <Button
        type="submit"
        disabled={busy || !originId || !destId}
        className="w-full"
      >
        {busy ? "Spawning…" : "Spawn Trader"}
      </Button>
    </form>
  );
}

// ─── Main screen ──────────────────────────────────────────────────────────────

type TabKey = "active" | "delivered" | "spawn";

export function TraderScreen() {
  const { games, activeGame, setSelectedGameId } = useActiveGame();
  const [tab, setTab] = useState<TabKey>("active");

  const gameId = activeGame?._id;
  const currentTurn = activeGame?.currentTurn ?? 0;

  const activeData = useQuery(
    api.eco.queries.listTradersWithDetails,
    gameId ? { gameId, statusFilter: "enRoute", limit: 64 } : "skip",
  );

  const npcRoster = useQuery(
    api.eco.queries.listNpcTraderIdentities,
    gameId ? { gameId } : "skip",
  );

  const deliveredData = useQuery(
    api.eco.queries.listTradersWithDetails,
    gameId && tab === "delivered"
      ? { gameId, statusFilter: "delivered", limit: 40 }
      : "skip",
  );

  const activeTraders = activeData?.traders ?? [];
  const deliveredTraders = deliveredData?.traders ?? [];
  const allSystems = activeData?.systems ?? [];

  const tabs: { key: TabKey; label: string; count?: number }[] = [
    { key: "active", label: "Active", count: activeTraders.length },
    { key: "delivered", label: "Delivered" },
    { key: "spawn", label: "Spawn Trader" },
  ];

  return (
    <div className="space-y-4">
      {/* Game selector */}
      <Card>
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-st-muted">
            Game
          </h2>
          <div className="flex flex-wrap gap-2">
            {games.map((g) => (
              <button
                key={g._id}
                type="button"
                onClick={() => setSelectedGameId(g._id)}
                className={`rounded-md px-3 py-1 text-sm transition-colors ${
                  activeGame?._id === g._id
                    ? "bg-st-accent text-slate-950 font-medium"
                    : "border border-st-border text-st-muted hover:text-st-fg"
                }`}
              >
                {g.name}
              </button>
            ))}
          </div>
          {activeGame != null && (
            <span className="ml-auto text-xs text-st-muted">Turn {currentTurn}</span>
          )}
        </div>
      </Card>

      {activeGame == null ? (
        <Card>
          <p className="text-sm text-st-muted text-center py-6">Select a game above to view traders.</p>
        </Card>
      ) : (
        <>
          {/* Tab bar */}
          <div className="flex gap-1 border-b border-st-border">
            {tabs.map(({ key, label, count }) => (
              <button
                key={key}
                type="button"
                onClick={() => setTab(key)}
                className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
                  tab === key
                    ? "border-st-accent text-st-fg"
                    : "border-transparent text-st-muted hover:text-st-fg"
                }`}
              >
                {label}
                {count !== undefined && count > 0 && (
                  <span className="ml-1.5 rounded-full bg-st-accent/20 px-1.5 py-0.5 text-[10px] text-amber-400">
                    {count}
                  </span>
                )}
              </button>
            ))}
          </div>

          {npcRoster !== undefined && npcRoster.length > 0 ? (
            <Card>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-st-muted mb-2">
                NPC merchant pool
              </h3>
              <ul className="max-h-48 overflow-y-auto space-y-1 text-[11px]">
                {[...npcRoster]
                  .sort((a, b) => a.slotOrder - b.slotOrder)
                  .map((r) => (
                    <li
                      key={r._id}
                      className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5 border-b border-st-border/50 pb-1 last:border-0"
                    >
                      <span className="min-w-0 flex-1 truncate font-medium text-st-fg">
                        {r.displayName}
                      </span>
                      <span
                        className={
                          r.state === "active"
                            ? "text-emerald-400"
                            : r.state === "bankrupt"
                              ? "text-red-400"
                              : "text-st-muted"
                        }
                      >
                        {r.state}
                      </span>
                      <span className="shrink-0 font-mono tabular-nums text-st-muted">
                        {Math.round(r.treasury).toLocaleString()} cr
                      </span>
                    </li>
                  ))}
              </ul>
            </Card>
          ) : null}

          {/* Active traders */}
          {tab === "active" && (
            <div className="space-y-3">
              {activeData === undefined && (
                <p className="text-sm text-st-muted text-center py-8">Loading…</p>
              )}
              {activeData !== undefined && activeTraders.length === 0 && (
                <Card>
                  <p className="text-sm text-st-muted text-center py-6">
                    No traders currently en route. Use <strong>Spawn Trader</strong> to inject one.
                  </p>
                </Card>
              )}
              {activeTraders.map((t) => (
                <TraderCard
                  key={t._id}
                  trader={t as EnrichedTrader}
                  currentTurn={currentTurn}
                />
              ))}
            </div>
          )}

          {/* Delivered */}
          {tab === "delivered" && (
            <div className="space-y-3">
              {deliveredData === undefined && (
                <p className="text-sm text-st-muted text-center py-8">Loading…</p>
              )}
              {deliveredData !== undefined && deliveredTraders.length === 0 && (
                <Card>
                  <p className="text-sm text-st-muted text-center py-6">
                    No deliveries recorded yet.
                  </p>
                </Card>
              )}
              {deliveredTraders.map((t) => (
                <TraderCard
                  key={t._id}
                  trader={t as EnrichedTrader}
                  currentTurn={currentTurn}
                />
              ))}
            </div>
          )}

          {/* Spawn */}
          {tab === "spawn" && (
            <Card>
              <h3 className="text-sm font-semibold text-st-fg mb-4">
                Spawn NPC Trader
                <span className="ml-2 text-[10px] font-normal text-amber-400 uppercase tracking-wide">
                  Admin
                </span>
              </h3>
              <p className="text-xs text-st-muted mb-4">
                Spawns a trader along the shortest hyperspace lane path (multi-hop allowed).
                Expected revenue must clear ~1.6× full voyage cost (cargo purchase + ship hire +
                docking) or the voyage is refused; weaker margins trigger a warning under ~2.2×.
                Origin stock is not deducted (admin injection).
              </p>
              {allSystems.length === 0 ? (
                <p className="text-sm text-st-muted">Loading systems…</p>
              ) : (
                <SpawnTraderForm gameId={activeGame._id} systems={allSystems as SystemInfo[]} />
              )}
            </Card>
          )}

          {/* Summary footer */}
          {tab === "active" && activeTraders.length > 0 && (
            <div className="grid grid-cols-3 gap-3">
              <Card className="text-center">
                <p className="text-2xl font-bold text-sky-400">{activeTraders.length}</p>
                <p className="text-xs text-st-muted mt-1">En Route</p>
              </Card>
              <Card className="text-center">
                <p className="text-2xl font-bold text-amber-400">
                  {fmtUnits(activeTraders.reduce((s, t) => s + t.cargoUnits, 0))}
                </p>
                <p className="text-xs text-st-muted mt-1">Total Cargo</p>
              </Card>
              <Card className="text-center">
                <p className="text-2xl font-bold text-emerald-400">
                  {fmtCredits(activeTraders.reduce((s, t) => s + t.totalShipCost, 0))}
                </p>
                <p className="text-xs text-st-muted mt-1">Ship Costs</p>
              </Card>
            </div>
          )}
        </>
      )}
    </div>
  );
}
