import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Button } from "@/components/ui/button";
import type { MapCatalogRow, MapTopologySystem } from "../../../../convex/sim/mapCatalog";
import {
  GALAXY_STAGE_HEIGHT,
  GALAXY_STAGE_WIDTH,
  MAP_BUTTON_ZOOM_FACTOR,
  MAX_MAP_SCALE,
  STAR_CLICK_RECENTER_FRACTION,
  STAR_CLICK_ZOOM_FRACTION,
} from "../constants";
import {
  clampMapScale,
  computeFitAllSystemsCamera,
  nextQuarterTurnClockwise,
  type GalaxyMapCamera,
  zoomCameraTowardScreenPoint,
} from "../utils/mapCamera";
import {
  GalaxyStage,
  type GalaxyLink,
  type GalaxyNode,
} from "../pixi/GalaxyStage";
import type { GalaxyLinkRow } from "../utils/linkAdjacency";

type ViewSize = {
  width: number;
  height: number;
};

function ownerColor(owner: MapTopologySystem["startingOwner"]): string {
  switch (owner) {
    case "aurora":
      return "#22d3ee";
    case "iron":
      return "#ef4444";
    default:
      return "#cbd5e1";
  }
}

function fitCamera(
  positions: readonly { x: number; y: number }[],
  viewSize: ViewSize,
  rotation = 0,
): GalaxyMapCamera {
  return computeFitAllSystemsCamera(positions, viewSize.width, viewSize.height, rotation);
}

export function StaticGalaxyMapPreview(props: { map: MapCatalogRow }) {
  const definition = props.map.definition ?? null;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [viewSize, setViewSize] = useState<ViewSize>({
    width: GALAXY_STAGE_WIDTH,
    height: GALAXY_STAGE_HEIGHT,
  });

  const nodes = useMemo<GalaxyNode[]>(() => {
    if (definition === null) return [];
    return definition.systems.map((system) => ({
      id: system.key,
      x: system.x,
      y: system.y,
      ownerColor: ownerColor(system.startingOwner),
      isPriority: system.isHomeworld,
    }));
  }, [definition]);

  const links = useMemo<GalaxyLink[]>(() => {
    if (definition === null) return [];
    return definition.routes.map((route) => ({
      fromId: route.fromKey,
      toId: route.toKey,
    }));
  }, [definition]);

  const galaxyLinks = useMemo<GalaxyLinkRow[]>(() => {
    if (definition === null) return [];
    return definition.routes.map((route) => ({
      fromSystemId: route.fromKey,
      toSystemId: route.toKey,
    }));
  }, [definition]);

  const systemByKey = useMemo(
    () => new Map((definition?.systems ?? []).map((system) => [system.key, system])),
    [definition],
  );
  const routeCountByKey = useMemo(() => {
    const counts = new Map<string, number>();
    definition?.routes.forEach((route) => {
      counts.set(route.fromKey, (counts.get(route.fromKey) ?? 0) + 1);
      counts.set(route.toKey, (counts.get(route.toKey) ?? 0) + 1);
    });
    return counts;
  }, [definition]);

  const [selectedSystemId, setSelectedSystemId] = useState<string | null>(null);
  const [camera, setCamera] = useState<GalaxyMapCamera>(() =>
    fitCamera([], { width: GALAXY_STAGE_WIDTH, height: GALAXY_STAGE_HEIGHT }),
  );

  useLayoutEffect(() => {
    const element = containerRef.current;
    if (element === null) return;

    const update = () => {
      const nextWidth = Math.max(320, Math.round(element.clientWidth));
      const nextHeight = Math.max(320, Math.round(element.clientHeight));
      setViewSize((current) =>
        current.width === nextWidth && current.height === nextHeight
          ? current
          : { width: nextWidth, height: nextHeight },
      );
    };

    update();
    const observer = new ResizeObserver(() => update());
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (nodes.length === 0) {
      setSelectedSystemId(null);
      return;
    }
    setSelectedSystemId(null);
    setCamera(fitCamera(nodes, viewSize));
  }, [props.map.key, nodes, viewSize]);

  const selectedSystem = selectedSystemId === null ? null : systemByKey.get(selectedSystemId) ?? null;
  const selectedRouteCount = selectedSystem === null ? 0 : routeCountByKey.get(selectedSystem.key) ?? 0;

  function handleStarTap(systemId: string) {
    if (selectedSystemId === systemId) {
      setSelectedSystemId(null);
      return;
    }
    setSelectedSystemId(systemId);
    const system = systemByKey.get(systemId);
    if (system === undefined) {
      return;
    }
    setCamera((current) => ({
      focusX: current.focusX + (system.x - current.focusX) * STAR_CLICK_RECENTER_FRACTION,
      focusY: current.focusY + (system.y - current.focusY) * STAR_CLICK_RECENTER_FRACTION,
      scale: clampMapScale(current.scale + (MAX_MAP_SCALE - current.scale) * STAR_CLICK_ZOOM_FRACTION),
      rotation: current.rotation,
    }));
  }

  function zoomFromCenter(factor: number) {
    setCamera((current) =>
      zoomCameraTowardScreenPoint(
        current,
        viewSize.width / 2,
        viewSize.height / 2,
        current.scale * factor,
        viewSize.width,
        viewSize.height,
      ),
    );
  }

  function resetView() {
    if (nodes.length === 0) return;
    setCamera(fitCamera(nodes, viewSize, camera.rotation));
  }

  if (definition === null) {
    return (
      <div className="rounded-xl border border-dashed border-st-border bg-st-panel/70 px-4 py-5 text-sm text-st-muted">
        This map record does not have stored topology yet. Use Sync built-ins to backfill the real systems and routes.
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-st-border bg-st-panel/90">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-st-border/70 px-4 py-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-st-muted">Interactive map preview</p>
          <p className="text-sm text-st-muted">Shared Pixi renderer driven by stored systems and routes.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={() => zoomFromCenter(1 / MAP_BUTTON_ZOOM_FACTOR)}>
            Zoom out
          </Button>
          <Button type="button" variant="outline" onClick={() => zoomFromCenter(MAP_BUTTON_ZOOM_FACTOR)}>
            Zoom in
          </Button>
          <Button type="button" variant="outline" onClick={() => setCamera((current) => ({ ...current, rotation: nextQuarterTurnClockwise(current.rotation) }))}>
            Rotate
          </Button>
          <Button type="button" variant="outline" onClick={resetView}>
            Fit
          </Button>
        </div>
      </div>

      <div className="grid gap-4 p-4 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <div ref={containerRef} className="relative h-136 min-h-112 overflow-hidden rounded-xl border border-st-border bg-[#080d1e]">
          <GalaxyStage
            viewWidth={viewSize.width}
            viewHeight={viewSize.height}
            camera={camera}
            onCameraChange={setCamera}
            nodes={nodes}
            links={links}
            galaxyLinks={galaxyLinks}
            fleetMarkers={[]}
            colonyShipMarkers={[]}
            pendingSegments={[]}
            routeSegments={[]}
            enRouteGhosts={[]}
            traderShips={[]}
            combatMarkers={[]}
            turnTimeline={null}
            selectedFleetId={null}
            onSelectedFleetChange={() => {}}
            selectedTraderId={null}
            onSelectedTraderChange={() => {}}
            selectedSystemId={selectedSystemId}
            selectedColonyShipId={null}
            onSelectedColonyShipChange={() => {}}
            shipsToDispatch={0}
            repeatNextDragEnabled={false}
            canIssueOrders={false}
            foodAlerts={[]}
            starvationAlerts={[]}
            onStarPointerTap={handleStarTap}
            onStarDoubleTap={handleStarTap}
            onStageBackgroundTap={() => setSelectedSystemId(null)}
            allowTouchFreeSpin={true}
          />
          <div className="pointer-events-none absolute bottom-3 left-3 flex gap-2 text-xs text-st-muted">
            <span className="rounded border border-st-border bg-st-bg/85 px-2 py-1">Systems {definition.systems.length}</span>
            <span className="rounded border border-st-border bg-st-bg/85 px-2 py-1">Routes {definition.routes.length}</span>
          </div>
        </div>

        <div className="space-y-3 rounded-xl border border-st-border bg-st-bg/60 p-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-st-muted">Selection</p>
            <h3 className="mt-1 text-base font-semibold text-st-fg">
              {selectedSystem?.name ?? "No star selected"}
            </h3>
            <p className="mt-1 text-sm text-st-muted">
              {selectedSystem === null
                ? "Tap a star on the map to inspect its actual stored layout data."
                : selectedSystem.key}
            </p>
          </div>

          {selectedSystem !== null ? (
            <div className="grid gap-2 text-sm text-st-muted">
              <div className="rounded border border-st-border bg-st-panel px-3 py-2">
                <span className="text-xs uppercase tracking-[0.16em] text-st-muted/80">Owner</span>
                <div className="mt-1 text-st-fg">{selectedSystem.startingOwner}</div>
              </div>
              <div className="rounded border border-st-border bg-st-panel px-3 py-2">
                <span className="text-xs uppercase tracking-[0.16em] text-st-muted/80">Resource richness</span>
                <div className="mt-1 text-st-fg">{selectedSystem.resourceRichness.toFixed(2)}</div>
              </div>
              <div className="rounded border border-st-border bg-st-panel px-3 py-2">
                <span className="text-xs uppercase tracking-[0.16em] text-st-muted/80">Coordinates</span>
                <div className="mt-1 text-st-fg">{Math.round(selectedSystem.x)}, {Math.round(selectedSystem.y)}</div>
              </div>
              <div className="rounded border border-st-border bg-st-panel px-3 py-2">
                <span className="text-xs uppercase tracking-[0.16em] text-st-muted/80">Routes</span>
                <div className="mt-1 text-st-fg">{selectedRouteCount}</div>
              </div>
              <div className="rounded border border-st-border bg-st-panel px-3 py-2">
                <span className="text-xs uppercase tracking-[0.16em] text-st-muted/80">Homeworld</span>
                <div className="mt-1 text-st-fg">{selectedSystem.isHomeworld ? "Yes" : "No"}</div>
              </div>
            </div>
          ) : (
            <div className="rounded border border-dashed border-st-border bg-st-panel/50 px-3 py-4 text-sm text-st-muted">
              The map stage supports pan, zoom, rotate, touch spin, and star selection using the same shared Pixi renderer as the game map.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}