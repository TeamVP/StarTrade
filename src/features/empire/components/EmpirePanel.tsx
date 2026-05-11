import { useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { Card } from "@/components/ui/card";
import { useActiveGame } from "@/features/galaxy/hooks/useActiveGame";
import { formatPopulationPeople } from "@/lib/populationFormat";

export function EmpirePanel() {
  const { activeGame } = useActiveGame();
  const systems =
    useQuery(
      api.gal.queries.listSystems,
      activeGame ? { gameId: activeGame._id, limit: 50 } : "skip",
    ) ?? [];
  const empires =
    useQuery(
      api.emp.queries.listEmpires,
      activeGame ? { gameId: activeGame._id, limit: 20 } : "skip",
    ) ?? [];

  return (
    <Card>
      <h2 className="text-sm font-semibold uppercase tracking-wide text-st-muted">
        Empire Snapshot
      </h2>
      <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
        <dt className="text-st-muted">Active Game</dt>
        <dd className="text-right">{activeGame?.name ?? "None"}</dd>
        <dt className="text-st-muted">Status</dt>
        <dd className="text-right capitalize">{activeGame?.status ?? "—"}</dd>
        <dt className="text-st-muted">Turn</dt>
        <dd className="text-right">{activeGame?.currentTurn ?? "—"}</dd>
        <dt className="text-st-muted">Systems</dt>
        <dd className="text-right">{systems.length}</dd>
        <dt className="text-st-muted">Empires</dt>
        <dd className="text-right">{empires.length}</dd>
      </dl>
      {empires.length > 0 ? (
        <ul className="mt-3 space-y-2 border-t border-st-border pt-3 text-xs">
          {empires.map((empire) => (
            <li key={empire._id} className="flex justify-between gap-2">
              <span className="flex items-center gap-2">
                <span
                  className="inline-block size-2 rounded-full"
                  style={{ backgroundColor: empire.colorHex }}
                  aria-hidden
                />
                {empire.name}
              </span>
              <span className="text-st-muted">
                Treasury {Math.round(empire.treasury)} · Pop{" "}
                {formatPopulationPeople(empire.population)}
                {(empire.researchPool ?? 0) > 0
                  ? ` · Res ${Math.round(empire.researchPool ?? 0)}`
                  : ""}
                {(empire.insolvencyTurns ?? 0) > 0
                  ? ` · Debt ${empire.insolvencyTurns}t`
                  : ""}
                {empire.isCollapsed ? " · Collapsed" : ""}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </Card>
  );
}
