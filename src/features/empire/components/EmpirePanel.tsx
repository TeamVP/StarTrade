import { useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { Card } from "@/components/ui/card";
import { useGalaxyMapNav } from "@/features/galaxy/context/GalaxyMapNavContext";
import { useActiveGame } from "@/features/galaxy/hooks/useActiveGame";
import { formatPopulationPeople } from "@/lib/populationFormat";

function resolveHomeworldSystemId(
  empire: { _id: Id<"emp_states">; homeSystemId: Id<"gal_systems"> | null },
  systems: {
    _id: Id<"gal_systems">;
    ownerEmpireId: Id<"emp_states"> | null;
    isHomeworld: boolean;
  }[],
): Id<"gal_systems"> | null {
  if (empire.homeSystemId !== null) return empire.homeSystemId;
  const homeworld = systems.find(
    (s) => s.ownerEmpireId === empire._id && s.isHomeworld,
  );
  if (homeworld !== undefined) return homeworld._id;
  const anyOwned = systems.find((s) => s.ownerEmpireId === empire._id);
  return anyOwned?._id ?? null;
}

export function EmpirePanel() {
  const { activeGame } = useActiveGame();
  const galaxyMapNav = useGalaxyMapNav();
  const requestEmpireHomeworldFocus = galaxyMapNav?.requestEmpireHomeworldFocus;
  const systems =
    useQuery(
      api.gal.queries.listSystems,
      activeGame ? { gameId: activeGame._id, limit: 200 } : "skip",
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
          {empires.map((empire) => {
            const homeworldId = resolveHomeworldSystemId(empire, systems);
            const canFocusHomeworld =
              requestEmpireHomeworldFocus !== undefined && homeworldId !== null;
            return (
            <li key={empire._id} className="flex justify-between gap-2">
              <span className="flex items-center gap-2">
                <span
                  className="inline-block size-2 rounded-full"
                  style={{ backgroundColor: empire.colorHex }}
                  aria-hidden
                />
                <span>
                  {canFocusHomeworld ? (
                    <button
                      type="button"
                      className="block max-w-[11rem] truncate text-left font-medium text-cyan-200/95 underline decoration-cyan-500/40 decoration-dotted underline-offset-2 hover:text-cyan-100 hover:decoration-cyan-300/70"
                      title="Pan map to this empire’s homeworld"
                      onClick={() => requestEmpireHomeworldFocus(empire._id)}
                    >
                      {empire.name}
                    </button>
                  ) : (
                    <span className="block font-medium text-st-fg">{empire.name}</span>
                  )}
                  {empire.playerName !== undefined ? (
                    <span className="block text-[11px] text-st-muted">
                      {empire.controller === "npc" ? "NPC" : "Player"}:{" "}
                      {empire.playerName}
                    </span>
                  ) : null}
                </span>
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
            );
          })}
        </ul>
      ) : null}
    </Card>
  );
}
