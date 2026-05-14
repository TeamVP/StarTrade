import { startTransition, useState, useMemo, useEffect } from "react";
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
  /** Net credits on delivery; absent on older rows. */
  deliveryProfit?: number;
  deliveryRevenue?: number;
  deliveryCost?: number;
  deliveryPurchaseCredits?: number;
  deliveryShipHireTotal?: number;
  deliveryDockingFee?: number;
  deliveryClearingUnitPrice?: number;
  deliveryNominalUnitPrice?: number;
  deliveryInvoiceCredits?: number;
  deliveryTreasuryShortfall?: number;
  deliveryBuyerUnderpaid?: boolean;
};

/** Buy price per commodity unit at origin (shown in settlement modal). */
function fmtBuyPricePerUnit(n: number): string {
  return n.toFixed(2);
}

function DeliverySettlementModal({
  trader,
  dockingFallback,
  onClose,
}: {
  trader: EnrichedTrader;
  dockingFallback: number;
  onClose: () => void;
}) {
  const purchase =
    trader.deliveryPurchaseCredits ?? Math.round(trader.cargoUnits * trader.boughtAtPrice);
  const shipHire = trader.deliveryShipHireTotal ?? trader.totalShipCost;
  const docking = trader.deliveryDockingFee ?? dockingFallback;
  const voyageOverhead = shipHire + docking;
  const totalExpenses = purchase + voyageOverhead;
  const revenue = trader.deliveryRevenue;
  const invoice = trader.deliveryInvoiceCredits;
  const shortfall = trader.deliveryTreasuryShortfall;
  const profit = trader.deliveryProfit;
  const effectiveUnit =
    revenue !== undefined && trader.cargoUnits > 0 ? revenue / trader.cargoUnits : null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/65 backdrop-blur-[2px]"
      role="presentation"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="settlement-title"
        className="max-w-md w-full max-h-[min(90vh,520px)] overflow-y-auto rounded-xl border border-st-border bg-st-bg shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 flex items-center justify-between gap-2 border-b border-st-border bg-st-bg/95 px-4 py-3">
          <h2 id="settlement-title" className="text-sm font-semibold text-st-fg">
            Settlement breakdown
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-2 py-1 text-xs text-st-muted hover:bg-st-panel hover:text-st-fg"
          >
            Close
          </button>
        </div>
        <div className="space-y-4 px-4 py-4 text-sm">
          <p className="text-xs text-st-muted leading-relaxed">
            {trader.originName} → {trader.destName} · {fmtUnits(trader.cargoUnits)} {trader.commodity}{" "}
            · delivered turn {trader.etaTurn}
          </p>

          <div>
            <h3 className="text-[10px] font-semibold uppercase tracking-wider text-st-muted mb-2">
              Costs (trader pays)
            </h3>
            <table className="w-full text-xs">
              <tbody className="divide-y divide-st-border/60">
                <tr>
                  <td className="py-1.5 text-st-muted">
                    Purchase at origin ({fmtUnits(trader.cargoUnits)} {trader.commodity} ×{" "}
                    {fmtBuyPricePerUnit(trader.boughtAtPrice)} cr)
                  </td>
                  <td className="py-1.5 text-right font-mono tabular-nums text-st-fg">
                    {fmtCredits(purchase)}
                  </td>
                </tr>
                <tr>
                  <td className="py-1.5 text-st-muted">
                    Ship hire ({fmtCredits(trader.shipHireCostPerTurn)}/turn × {trader.travelTurns})
                  </td>
                  <td className="py-1.5 text-right font-mono tabular-nums text-st-fg">
                    {fmtCredits(shipHire)}
                  </td>
                </tr>
                <tr>
                  <td className="py-1.5 text-st-muted">Docking fee</td>
                  <td className="py-1.5 text-right font-mono tabular-nums text-st-fg">
                    {fmtCredits(docking)}
                  </td>
                </tr>
                <tr className="font-medium">
                  <td className="py-2 text-st-fg">Total expenses</td>
                  <td className="py-2 text-right font-mono tabular-nums text-st-fg">
                    {fmtCredits(totalExpenses)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <div>
            <h3 className="text-[10px] font-semibold uppercase tracking-wider text-st-muted mb-2">
              Sale (buyer pays captain)
            </h3>
            {trader.commodity === "food" &&
            trader.deliveryClearingUnitPrice !== undefined &&
            trader.deliveryNominalUnitPrice !== undefined ? (
              <p className="text-[11px] text-st-muted mb-2 leading-relaxed">
                Food uses the destination&apos;s <span className="text-st-fg">current market</span> price before
                your cargo updates local stock. When several ships dock the same turn, payment is{" "}
                <span className="text-st-fg">split fairly</span> from one treasury withdrawal.
                Later arrivals see the updated price and treasury.
              </p>
            ) : null}
            {revenue === undefined ? (
              <p className="text-xs text-st-muted">Revenue not stored for this legacy delivery.</p>
            ) : (
              <table className="w-full text-xs">
                <tbody className="divide-y divide-st-border/60">
                  {trader.deliveryClearingUnitPrice !== undefined ? (
                    <tr>
                      <td className="py-1.5 text-st-muted">Clearing price / unit (before cargo)</td>
                      <td className="py-1.5 text-right font-mono tabular-nums text-st-fg">
                        {trader.deliveryClearingUnitPrice.toFixed(2)} cr
                      </td>
                    </tr>
                  ) : null}
                  {trader.deliveryNominalUnitPrice !== undefined ? (
                    <tr>
                      <td className="py-1.5 text-st-muted">Nominal invoice / unit (full subsidy + clearing)</td>
                      <td className="py-1.5 text-right font-mono tabular-nums text-st-fg">
                        {trader.deliveryNominalUnitPrice.toFixed(2)} cr
                      </td>
                    </tr>
                  ) : null}
                  {invoice !== undefined ? (
                    <tr>
                      <td className="py-1.5 text-st-muted">Nominal invoice (this cargo)</td>
                      <td className="py-1.5 text-right font-mono tabular-nums text-st-fg">
                        {fmtCredits(invoice)}
                      </td>
                    </tr>
                  ) : null}
                  <tr className="font-medium">
                    <td className="py-1.5 text-st-fg">Credits actually received</td>
                    <td className="py-1.5 text-right font-mono tabular-nums text-emerald-300">
                      {fmtCredits(revenue)}
                    </td>
                  </tr>
                  {effectiveUnit !== null ? (
                    <tr>
                      <td className="py-1.5 text-st-muted">Effective price received / unit</td>
                      <td className="py-1.5 text-right font-mono tabular-nums text-st-fg">
                        {effectiveUnit.toFixed(2)} cr
                      </td>
                    </tr>
                  ) : null}
                  {shortfall !== undefined && shortfall > 0 ? (
                    <tr>
                      <td className="py-1.5 text-amber-400">Treasury shortfall (unpaid invoice)</td>
                      <td className="py-1.5 text-right font-mono tabular-nums text-amber-400">
                        {fmtCredits(shortfall)}
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            )}
            {trader.deliveryBuyerUnderpaid ? (
              <p className="mt-2 text-[11px] text-amber-300/95 leading-relaxed">
                The destination could not pay the full nominal invoice (empty treasury / import budget).
                Traders are paid only what was actually debited — this can look like a huge loss versus
                expected market price.
              </p>
            ) : null}
          </div>

          <div
            className={`rounded-lg border px-3 py-2.5 ${
              profit === undefined
                ? "border-st-border bg-st-panel text-st-muted"
                : profit >= 0
                  ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-200"
                  : "border-red-500/40 bg-red-500/10 text-red-200"
            }`}
          >
            <p className="text-[10px] font-semibold uppercase tracking-wide text-st-muted mb-1">
              Net P&amp;L
            </p>
            <p className="text-sm font-mono tabular-nums leading-relaxed">
              {profit === undefined
                ? "—"
                : (() => {
                    const rec = revenue ?? 0;
                    const exp = totalExpenses;
                    if (profit >= 0) {
                      return `${fmtCredits(rec)} − ${fmtCredits(exp)} = ${fmtCredits(profit)} profit`;
                    }
                    return `${fmtCredits(rec)} − ${fmtCredits(exp)} = −${fmtCredits(-profit)} loss`;
                  })()}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function TraderCard({
  trader,
  currentTurn,
  dockingFeeDefault,
}: {
  trader: EnrichedTrader;
  currentTurn: number;
  dockingFeeDefault: number;
}) {
  const [detailOpen, setDetailOpen] = useState(false);
  const turnsLeft = Math.max(0, trader.etaTurn - currentTurn);
  const purchaseCredits =
    trader.deliveryPurchaseCredits ?? Math.round(trader.cargoUnits * trader.boughtAtPrice);
  const shipHire = trader.deliveryShipHireTotal ?? trader.totalShipCost;
  const docking = trader.deliveryDockingFee ?? dockingFeeDefault;
  const voyageOverhead = shipHire + docking;
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

      {trader.status === "delivered" ? (
        <div className="space-y-2">
        <div
          className={`rounded-md border px-3 py-2 text-sm ${
            trader.deliveryProfit === undefined
              ? "border-st-border bg-st-panel text-st-muted"
              : trader.deliveryProfit >= 0
                ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-200"
                : "border-red-500/40 bg-red-500/10 text-red-200"
          }`}
        >
          {trader.deliveryProfit === undefined ? (
            <span>Voyage result: not recorded (legacy delivery).</span>
          ) : trader.deliveryProfit >= 0 ? (
            <span>
              <span className="font-semibold">Made money</span>
              <span className="text-st-muted"> — net profit </span>
              <span className="font-mono tabular-nums">{fmtCredits(trader.deliveryProfit)}</span>
            </span>
          ) : (
            <span>
              <span className="font-semibold">Lost money</span>
              <span className="text-st-muted"> — net loss </span>
              <span className="font-mono tabular-nums">{fmtCredits(-trader.deliveryProfit)}</span>
            </span>
          )}
        </div>
          <button
            type="button"
            onClick={() => setDetailOpen(true)}
            className="text-xs text-sky-400 hover:text-sky-300 underline underline-offset-2"
          >
            Settlement details…
          </button>
        </div>
      ) : null}

      {detailOpen ? (
        <DeliverySettlementModal
          trader={trader}
          dockingFallback={dockingFeeDefault}
          onClose={() => setDetailOpen(false)}
        />
      ) : null}

      {/* Cost breakdown */}
      <div className="grid grid-cols-3 gap-2 text-xs">
        <div className="rounded bg-st-panel px-2 py-1.5 space-y-0.5">
          <p className="text-st-muted uppercase tracking-wide text-[9px]">Purchase</p>
          <p className="font-semibold tabular-nums">{fmtCredits(purchaseCredits)}</p>
          <p className="text-[9px] text-st-muted">origin buy</p>
        </div>
        <div className="rounded bg-st-panel px-2 py-1.5 space-y-0.5">
          <p className="text-st-muted uppercase tracking-wide text-[9px]">Ship hire</p>
          <p className="font-semibold tabular-nums">{fmtCredits(shipHire)}</p>
          <p className="text-[9px] text-st-muted">{fmtCredits(trader.shipHireCostPerTurn)}/turn × {trader.travelTurns}</p>
        </div>
        <div className="rounded bg-st-panel px-2 py-1.5 space-y-0.5">
          <p className="text-st-muted uppercase tracking-wide text-[9px]">Docking</p>
          <p className="font-semibold tabular-nums">{fmtCredits(docking)}</p>
          <p className="text-[9px] text-st-muted">voyage overhead {fmtCredits(voyageOverhead)}</p>
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
        originSystemId: originId,
        destinationSystemId: destId,
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

type TabKey = "npcTraders" | "inTransit" | "delivered" | "embargoes" | "spawn";

export function TraderScreen() {
  const { games, activeGame, setSelectedGameId } = useActiveGame();
  const [tab, setTab] = useState<TabKey>("npcTraders");
  const [npcFundBusyId, setNpcFundBusyId] = useState<Id<"sim_trader_identities"> | null>(null);
  const [npcPoolError, setNpcPoolError] = useState<string | null>(null);
  const [npcHireChancePct, setNpcHireChancePct] = useState(20);
  const [npcHireChanceSaving, setNpcHireChanceSaving] = useState(false);

  const addNpcTraderTreasuryFunds = useMutation(api.eco.mutations.addNpcTraderTreasuryFunds);
  const updateNpcTraderHireChancePct = useMutation(
    api.eco.mutations.updateNpcTraderHireChancePct,
  );

  const gameId = activeGame?._id;
  const currentTurn = activeGame?.currentTurn ?? 0;

  useEffect(() => {
    startTransition(() => {
      setNpcPoolError(null);
      setNpcFundBusyId(null);
      setNpcHireChanceSaving(false);
      setNpcHireChancePct(20);
    });
  }, [gameId]);

  const activeData = useQuery(
    api.eco.queries.listTradersWithDetails,
    gameId ? { gameId, statusFilter: "enRoute", limit: 64 } : "skip",
  );

  const npcRoster = useQuery(
    api.eco.queries.listNpcTraderIdentities,
    gameId ? { gameId } : "skip",
  );

  const npcPoolSettings = useQuery(
    api.eco.queries.getNpcTraderPoolSettings,
    gameId ? { gameId } : "skip",
  );

  const deliveredData = useQuery(
    api.eco.queries.listTradersWithDetails,
    gameId && tab === "delivered"
      ? { gameId, statusFilter: "delivered", limit: 40 }
      : "skip",
  );

  const embargoData = useQuery(
    api.eco.queries.listActiveTraderEmbargoes,
    gameId ? { gameId } : "skip",
  );

  const activeTraders = activeData?.traders ?? [];
  const deliveredTraders = deliveredData?.traders ?? [];
  const allSystems = activeData?.systems ?? [];
  const traderDockingFeeDefault =
    activeData?.traderDockingFee ?? deliveredData?.traderDockingFee ?? 100;
  const serverHireChancePct = npcPoolSettings?.traderHireChancePct;
  const hireChanceDirty =
    serverHireChancePct !== undefined &&
    Math.round(npcHireChancePct) !== Math.round(serverHireChancePct);

  useEffect(() => {
    if (serverHireChancePct === undefined) return;
    startTransition(() => {
      setNpcHireChancePct(serverHireChancePct);
    });
  }, [serverHireChancePct]);

  const embargoRowCount =
    (embargoData?.empires.length ?? 0) + (embargoData?.unownedSystems.length ?? 0);

  const tabs: { key: TabKey; label: string; count?: number }[] = [
    { key: "npcTraders", label: "NPC Traders" },
    { key: "inTransit", label: "In transit", count: activeTraders.length > 0 ? activeTraders.length : undefined },
    { key: "delivered", label: "Delivered" },
    { key: "embargoes", label: "Embargoes", count: embargoRowCount > 0 ? embargoRowCount : undefined },
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
          <div className="flex flex-wrap gap-1 border-b border-st-border">
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

          {tab === "npcTraders" && (
            <div className="space-y-3">
              {npcRoster === undefined && (
                <p className="text-sm text-st-muted text-center py-8">Loading…</p>
              )}
              {npcRoster !== undefined && npcRoster.length === 0 && (
                <Card>
                  <p className="text-sm text-st-muted text-center py-6">
                    No NPC merchant pool for this game yet.
                  </p>
                </Card>
              )}
              {npcRoster !== undefined && npcRoster.length > 0 ? (
                <Card>
                  <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-st-muted">
                      NPC merchant pool
                    </h3>
                    <span className="text-[10px] font-normal text-amber-400/90 uppercase tracking-wide">
                      Admin
                    </span>
                  </div>
                  <p className="mb-2 text-[10px] text-st-muted">
                    Add Funds credits 10,000 cr to that merchant (game admins only).
                  </p>
                  {npcPoolError !== null ? (
                    <p className="mb-2 text-[11px] text-red-400">{npcPoolError}</p>
                  ) : null}
                  <div className="mb-3 rounded-md border border-st-border/60 bg-st-bg/60 p-3">
                    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <div className="text-[11px] font-semibold uppercase tracking-wide text-st-fg">
                          Ship hire chance
                        </div>
                        <p className="text-[10px] text-st-muted">
                          Chance an NPC accepts a viable trade job on the next turn.
                        </p>
                      </div>
                      <span className="font-mono text-sm font-semibold tabular-nums text-amber-300">
                        {Math.round(npcHireChancePct)}%
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-3">
                      <input
                        type="range"
                        min={0}
                        max={100}
                        step={5}
                        value={npcHireChancePct}
                        disabled={npcPoolSettings === undefined || npcHireChanceSaving}
                        onChange={(e) => {
                          setNpcHireChancePct(Number(e.target.value));
                        }}
                        className="min-w-48 flex-1 h-1.5 appearance-none rounded-full bg-st-border cursor-pointer accent-st-accent disabled:cursor-not-allowed disabled:opacity-60"
                      />
                      <Button
                        type="button"
                        variant="secondary"
                        className="h-7 px-2 text-[10px]"
                        disabled={
                          activeGame === null ||
                          npcPoolSettings === undefined ||
                          npcHireChanceSaving ||
                          !hireChanceDirty
                        }
                        onClick={() => {
                          if (activeGame === null) return;
                          void (async () => {
                            setNpcPoolError(null);
                            setNpcHireChanceSaving(true);
                            try {
                              const result = await updateNpcTraderHireChancePct({
                                gameId: activeGame._id,
                                traderHireChancePct: npcHireChancePct,
                              });
                              setNpcHireChancePct(result.traderHireChancePct);
                            } catch (e) {
                              setNpcPoolError(
                                e instanceof Error ? e.message : "Could not update hire chance.",
                              );
                            } finally {
                              setNpcHireChanceSaving(false);
                            }
                          })();
                        }}
                      >
                        {npcHireChanceSaving ? "Saving…" : "Apply"}
                      </Button>
                    </div>
                  </div>
                  <ul className="max-h-56 overflow-y-auto space-y-1 text-[11px]">
                    {[...npcRoster]
                      .sort((a, b) => a.slotOrder - b.slotOrder)
                      .map((r) => (
                        <li
                          key={r._id}
                          className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 border-b border-st-border/50 pb-2 last:border-0"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="truncate font-medium text-st-fg">{r.displayName}</div>
                            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
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
                              <span className="font-mono tabular-nums text-st-muted">
                                {Math.round(r.treasury).toLocaleString()} cr
                              </span>
                            </div>
                          </div>
                          {r.kind === "npc" ? (
                            <Button
                              type="button"
                              variant="secondary"
                              className="h-7 shrink-0 px-2 text-[10px]"
                              disabled={npcFundBusyId === r._id || activeGame === null}
                              onClick={() => {
                                if (activeGame === null) return;
                                void (async () => {
                                  setNpcPoolError(null);
                                  setNpcFundBusyId(r._id);
                                  try {
                                    await addNpcTraderTreasuryFunds({
                                      gameId: activeGame._id,
                                      traderIdentityId: r._id,
                                    });
                                  } catch (e) {
                                    setNpcPoolError(
                                      e instanceof Error ? e.message : "Could not add funds.",
                                    );
                                  } finally {
                                    setNpcFundBusyId(null);
                                  }
                                })();
                              }}
                            >
                              {npcFundBusyId === r._id ? "Adding…" : "Add Funds"}
                            </Button>
                          ) : null}
                        </li>
                      ))}
                  </ul>
                </Card>
              ) : null}
            </div>
          )}

          {/* In transit — cargo en route */}
          {tab === "inTransit" && (
            <div className="space-y-3">
              {activeData === undefined && (
                <p className="text-sm text-st-muted text-center py-8">Loading…</p>
              )}
              {activeData !== undefined && activeTraders.length === 0 && (
                <Card>
                  <p className="text-sm text-st-muted text-center py-6">
                    No cargo in transit. Use <strong>Spawn Trader</strong> to inject a voyage, or wait
                    for the economy to dispatch NPC routes.
                  </p>
                </Card>
              )}
              {activeTraders.map((t) => (
                <TraderCard
                  key={t._id}
                  trader={t as EnrichedTrader}
                  currentTurn={currentTurn}
                  dockingFeeDefault={traderDockingFeeDefault}
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
                  dockingFeeDefault={traderDockingFeeDefault}
                />
              ))}
            </div>
          )}

          {/* NPC trade embargoes (non-payment) */}
          {tab === "embargoes" && (
            <div className="space-y-3">
              {embargoData === undefined && (
                <p className="text-sm text-st-muted text-center py-8">Loading…</p>
              )}
              {embargoData !== undefined && embargoRowCount === 0 && (
                <Card>
                  <p className="text-sm text-st-muted text-center py-6 leading-relaxed">
                    No active embargoes. Background NPC traders may still avoid a destination for
                    other reasons, but no empire or independent system is currently under a payment
                    boycott.
                  </p>
                </Card>
              )}
              {embargoData !== undefined && embargoRowCount > 0 ? (
                <Card className="space-y-4">
                  <div>
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-st-muted">
                      Trade embargoes
                    </h3>
                    <p className="mt-1 text-[11px] text-st-muted leading-relaxed">
                      These powers did not pay traders in full when cargo arrived. NPC background
                      traders will not <span className="text-st-fg">start new deliveries</span> to
                      their worlds until the embargo ends (30 turns from the incident). Turn{" "}
                      <span className="font-mono text-st-fg">{embargoData.currentTurn}</span>.
                    </p>
                  </div>

                  {embargoData.empires.length > 0 ? (
                    <div className="space-y-2">
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-st-muted">
                        Empires
                      </p>
                      <ul className="space-y-2 text-sm">
                        {embargoData.empires.map((e) => (
                          <li
                            key={e.empireId}
                            className="flex flex-wrap items-baseline justify-between gap-2 rounded-md border border-st-border/80 bg-st-panel/40 px-3 py-2"
                          >
                            <span className="font-medium text-st-fg">{e.name}</span>
                            <span className="text-xs text-st-muted">
                              Lifts turn{" "}
                              <span className="font-mono tabular-nums text-amber-300">
                                {e.boycottEndsTurn}
                              </span>
                              <span className="text-st-muted"> · </span>
                              <span className="text-st-fg">
                                {e.turnsRemaining === 1
                                  ? "1 turn left"
                                  : `${e.turnsRemaining} turns left`}
                              </span>
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}

                  {embargoData.unownedSystems.length > 0 ? (
                    <div className="space-y-2">
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-st-muted">
                        Independent systems
                      </p>
                      <ul className="space-y-2 text-sm">
                        {embargoData.unownedSystems.map((s) => (
                          <li
                            key={s.systemId}
                            className="flex flex-wrap items-baseline justify-between gap-2 rounded-md border border-st-border/80 bg-st-panel/40 px-3 py-2"
                          >
                            <span className="font-medium text-st-fg">{s.name}</span>
                            <span className="text-xs text-st-muted">
                              Lifts turn{" "}
                              <span className="font-mono tabular-nums text-amber-300">
                                {s.boycottEndsTurn}
                              </span>
                              <span className="text-st-muted"> · </span>
                              <span className="text-st-fg">
                                {s.turnsRemaining === 1
                                  ? "1 turn left"
                                  : `${s.turnsRemaining} turns left`}
                              </span>
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </Card>
              ) : null}
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
                <SpawnTraderForm gameId={activeGame._id} systems={allSystems} />
              )}
            </Card>
          )}

          {/* Summary footer */}
          {tab === "inTransit" && activeTraders.length > 0 && (
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
