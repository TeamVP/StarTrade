import { useMemo } from "react";
import { GalaxyStage, type GalaxyLink, type GalaxyNode } from "../pixi/GalaxyStage";
import { useGalaxyData } from "../hooks/useGalaxyData";

export function GalaxyViewport() {
  const { activeGame, systems, links, empireColors } = useGalaxyData();

  const nodeMap = useMemo<Record<string, GalaxyNode>>(() => {
    return Object.fromEntries(
      systems.map((system) => [
        system._id,
        {
          id: system._id,
          x: system.x,
          y: system.y,
          ownerColor:
            system.ownerEmpireId !== null
              ? (empireColors[system.ownerEmpireId] ?? "#64748b")
              : "#64748b",
        },
      ]),
    );
  }, [systems, empireColors]);
  const stageNodes = useMemo<GalaxyNode[]>(() => Object.values(nodeMap), [nodeMap]);
  const stageLinks = useMemo<GalaxyLink[]>(() => {
    return links
      .map((link) => ({
        fromId: link.fromSystemId,
        toId: link.toSystemId,
      }))
      .filter((link) => nodeMap[link.fromId] && nodeMap[link.toId]);
  }, [links, nodeMap]);

  return (
    <section className="overflow-hidden rounded-xl border border-st-border bg-st-panel p-2">
      <div className="mb-3 flex items-center justify-between px-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-st-muted">
          Galaxy Map
        </h2>
        <span className="text-xs text-st-muted">
          {activeGame ? `${stageNodes.length} systems` : "Create + seed a game"}
        </span>
      </div>
      <GalaxyStage nodes={stageNodes} links={stageLinks} />
    </section>
  );
}
