import { Card } from "@/components/ui/card";

export function CombatScreen() {
  return (
    <div className="space-y-4">
      <Card>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-st-muted">
          Combat
        </h2>
        <p className="mt-2 text-sm text-st-muted">
          Battle reports, collateral summaries, and resolution inspection will render here.
          Use{" "}
          <code className="rounded bg-st-bg px-1 py-0.5 text-xs text-st-fg">
            previewBattleOutcome
          </code>{" "}
          for lightweight UI previews until turn resolution writes battle docs.
        </p>
      </Card>
      <Card className="min-h-[200px] border-dashed">
        <p className="text-sm text-st-muted">Recent battles timeline (placeholder)</p>
      </Card>
    </div>
  );
}
