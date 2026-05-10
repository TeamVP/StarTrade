import { Card } from "@/components/ui/card";

export function EconomyScreen() {
  return (
    <div className="space-y-4">
      <Card>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-st-muted">
          Economy
        </h2>
        <p className="mt-2 text-sm text-st-muted">
          Price history (Recharts), production, stockpiles, and treasury indicators belong here.
          Shape series with{" "}
          <code className="rounded bg-st-bg px-1 py-0.5 text-xs text-st-fg">
            toRechartsSeries
          </code>{" "}
          from{" "}
          <code className="rounded bg-st-bg px-1 py-0.5 text-xs text-st-fg">
            eco_market_snapshots
          </code>{" "}
          queries.
        </p>
      </Card>
      <Card className="min-h-[240px] border-dashed">
        <p className="text-sm text-st-muted">Charts grid (placeholder)</p>
      </Card>
    </div>
  );
}
