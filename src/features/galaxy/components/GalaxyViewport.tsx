import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { Expand, Minus, Plus, Repeat2 } from "lucide-react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import {
  FLEET_ORBIT_RADIUS,
  MAP_BUTTON_ZOOM_FACTOR,
  MAP_CAMERA_TWEEN_MS,
  STAR_CLICK_ZOOM_FACTOR,
} from "../constants";
import {
  clampMapScale,
  computeFitAllSystemsCamera,
  computeMaxScaleForNeighborhood,
  easeOutCubic,
  type GalaxyMapCamera,
} from "../utils/mapCamera";
import { useGalaxyData } from "../hooks/useGalaxyData";
import {
  GalaxyStage,
  type EnRouteGhostModel,
  type FleetMarkerModel,
  type GalaxyLink,
  type GalaxyNode,
  type PendingSegmentModel,
  type RouteSegmentModel,
  type TurnTimelineModel,
} from "../pixi/GalaxyStage";
import type { GalaxyLinkRow } from "../utils/linkAdjacency";

export function GalaxyViewport() {
  const { activeGame, systems, links, empires, empireColors } = useGalaxyData();

  const fleetsQuery = useQuery(
    api.flt.queries.listFleetsForGame,
    activeGame ? { gameId: activeGame._id, limit: 200 } : "skip",
  );
  const fleets = useMemo(() => fleetsQuery ?? [], [fleetsQuery]);

  const pendingOrdersQuery = useQuery(
    api.flt.queries.listPendingMoveOrdersForTurn,
    activeGame?.status === "running"
      ? {
          gameId: activeGame._id,
          turnNumber: activeGame.currentTurn,
          limit: 200,
        }
      : "skip",
  );
  const pendingOrders = useMemo(() => pendingOrdersQuery ?? [], [pendingOrdersQuery]);

  const myRolesQuery = useQuery(
    api.usr.queries.listMyRoles,
    activeGame ? { gameId: activeGame._id } : "skip",
  );
  const myRoles = useMemo(() => myRolesQuery ?? [], [myRolesQuery]);

  const garrisonRoutesQuery = useQuery(
    api.flt.queries.listMyGarrisonRoutes,
    activeGame ? { gameId: activeGame._id } : "skip",
  );
  const garrisonRoutes = useMemo(() => garrisonRoutesQuery ?? [], [garrisonRoutesQuery]);

  const turnTimelineQuery = useQuery(
    api.sim.queries.getTurnTimelineForGame,
    activeGame ? { gameId: activeGame._id } : "skip",
  );
  const turnTimeline = useMemo((): TurnTimelineModel | null => {
    if (turnTimelineQuery === undefined || turnTimelineQuery === null) return null;
    return {
      currentTurn: turnTimelineQuery.currentTurn,
      turnStartedAt: turnTimelineQuery.turnStartedAt,
      turnDurationMs: turnTimelineQuery.turnDurationMs,
    };
  }, [turnTimelineQuery]);

  const issueFleetOrder = useMutation(api.flt.mutations.issueFleetOrder);
  const setGarrisonRoute = useMutation(api.flt.mutations.setGarrisonRoute);

  const [selectedFleetId, setSelectedFleetId] = useState<string | null>(null);
  const [selectedSystemId, setSelectedSystemId] = useState<string | null>(null);
  const [shipsToDispatch, setShipsToDispatch] = useState(1);
  const [repeatNextDragEnabled, setRepeatNextDragEnabled] = useState(false);
  const [routeEditorRouteId, setRouteEditorRouteId] = useState<string | null>(null);
  const [routeEditorPct, setRouteEditorPct] = useState(25);
  const [routeEditorEnabled, setRouteEditorEnabled] = useState(true);

  const [camera, setCamera] = useState<GalaxyMapCamera>(() =>
    computeFitAllSystemsCamera([]),
  );
  const fittedGameRef = useRef<string | null>(null);
  const cameraRef = useRef(camera);
  const tweenRafRef = useRef<number | null>(null);

  useEffect(() => {
    cameraRef.current = camera;
  }, [camera]);

  const cancelCameraTween = useCallback(() => {
    if (tweenRafRef.current !== null) {
      cancelAnimationFrame(tweenRafRef.current);
      tweenRafRef.current = null;
    }
  }, []);

  useEffect(() => () => cancelCameraTween(), [cancelCameraTween]);

  const handleCameraChange = useCallback(
    (next: GalaxyMapCamera) => {
      cancelCameraTween();
      setCamera({
        ...next,
        scale: clampMapScale(next.scale),
      });
    },
    [cancelCameraTween],
  );

  const startCameraTweenTo = useCallback(
    (target: GalaxyMapCamera) => {
      cancelCameraTween();
      const startSnapshot = cameraRef.current;
      const t0 = performance.now();

      const step = (now: number) => {
        const elapsed = now - t0;
        const t = Math.min(1, elapsed / MAP_CAMERA_TWEEN_MS);
        const k = easeOutCubic(t);
        const next: GalaxyMapCamera = {
          focusX: startSnapshot.focusX + (target.focusX - startSnapshot.focusX) * k,
          focusY: startSnapshot.focusY + (target.focusY - startSnapshot.focusY) * k,
          scale: clampMapScale(
            startSnapshot.scale + (target.scale - startSnapshot.scale) * k,
          ),
        };
        setCamera(next);
        if (t < 1) {
          tweenRafRef.current = requestAnimationFrame(step);
        } else {
          tweenRafRef.current = null;
        }
      };
      tweenRafRef.current = requestAnimationFrame(step);
    },
    [cancelCameraTween],
  );

  const empireNames = useMemo(
    () => Object.fromEntries(empires.map((e) => [e._id, e.name])),
    [empires],
  );

  const isAdmin = useMemo(() => myRoles.some((r) => r.role === "admin"), [myRoles]);

  const myEmpireId = useMemo(() => {
    const role = myRoles.find((r) => r.role === "empire");
    return role?.empireId ?? null;
  }, [myRoles]);

  const dismissStarPanel = useCallback(() => {
    setSelectedSystemId(null);
  }, []);

  const dismissRouteEditor = useCallback(() => {
    setRouteEditorRouteId(null);
  }, []);

  const handleStageBackgroundTap = useCallback(() => {
    dismissStarPanel();
    dismissRouteEditor();
  }, [dismissStarPanel, dismissRouteEditor]);

  const handleSelectedFleetChange = useCallback(
    (fleetId: string | null) => {
      setSelectedFleetId(fleetId);
      setSelectedSystemId(null);
      setRepeatNextDragEnabled(false);
      if (fleetId === null) return;
      const fleet = fleets.find((f) => f._id === fleetId);
      if (fleet !== undefined) {
        const mid = Math.max(1, Math.floor(fleet.strength / 2));
        setShipsToDispatch(Math.min(mid, fleet.strength));
      }
    },
    [fleets],
  );

  const handleRouteMidpointTap = useCallback(
    (routeId: string) => {
      const route = garrisonRoutes.find((r) => r._id === routeId);
      if (route === undefined) return;
      setRouteEditorRouteId(routeId);
      setRouteEditorPct(route.dispatchPct);
      setRouteEditorEnabled(route.enabled);
      setSelectedFleetId(null);
      setSelectedSystemId(null);
    },
    [garrisonRoutes],
  );

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

  useEffect(() => {
    if (!activeGame) {
      fittedGameRef.current = null;
      return;
    }
    if (stageNodes.length === 0) return;
    if (fittedGameRef.current !== activeGame._id) {
      fittedGameRef.current = activeGame._id;
      cancelCameraTween();
      setCamera(computeFitAllSystemsCamera(stageNodes));
    }
  }, [activeGame, stageNodes, cancelCameraTween]);

  const stageLinks = useMemo<GalaxyLink[]>(() => {
    return links
      .map((link) => ({
        fromId: link.fromSystemId,
        toId: link.toSystemId,
      }))
      .filter((link) => nodeMap[link.fromId] && nodeMap[link.toId]);
  }, [links, nodeMap]);

  const galaxyLinkRows = useMemo<GalaxyLinkRow[]>(() => {
    return links.map((link) => ({
      fromSystemId: link.fromSystemId,
      toSystemId: link.toSystemId,
    }));
  }, [links]);

  const handleStarTap = useCallback(
    (systemId: string) => {
      cancelCameraTween();
      setSelectedSystemId(systemId);
      setSelectedFleetId(null);
      setRouteEditorRouteId(null);
      const node = nodeMap[systemId];
      if (node === undefined) return;
      const neighborhoodCap = computeMaxScaleForNeighborhood(
        systemId,
        galaxyLinkRows,
        nodeMap,
        2,
      );
      setCamera((prev) => ({
        focusX: node.x,
        focusY: node.y,
        scale: clampMapScale(
          Math.min(prev.scale * STAR_CLICK_ZOOM_FACTOR, neighborhoodCap),
        ),
      }));
    },
    [nodeMap, galaxyLinkRows, cancelCameraTween],
  );

  const handleStarDoubleTap = useCallback(
    (systemId: string) => {
      cancelCameraTween();
      setSelectedSystemId(systemId);
      setSelectedFleetId(null);
      setRouteEditorRouteId(null);
      const node = nodeMap[systemId];
      if (node === undefined) return;
      startCameraTweenTo({
        focusX: node.x,
        focusY: node.y,
        scale: cameraRef.current.scale,
      });
    },
    [nodeMap, cancelCameraTween, startCameraTweenTo],
  );

  const zoomFromCenter = useCallback(
    (factor: number) => {
      cancelCameraTween();
      setCamera((c) => ({
        ...c,
        scale: clampMapScale(c.scale * factor),
      }));
    },
    [cancelCameraTween],
  );

  const resetMapView = useCallback(() => {
    if (stageNodes.length === 0) return;
    cancelCameraTween();
    setCamera(computeFitAllSystemsCamera(stageNodes));
  }, [stageNodes, cancelCameraTween]);

  const fleetMarkers = useMemo<FleetMarkerModel[]>(() => {
    if (!activeGame || activeGame.status !== "running") return [];
    const idle = fleets.filter((f) => f.status === "idle");
    const bySystem = new Map<string, typeof idle>();
    for (const fleet of idle) {
      const list = bySystem.get(fleet.originSystemId) ?? [];
      list.push(fleet);
      bySystem.set(fleet.originSystemId, list);
    }
    const markers: FleetMarkerModel[] = [];
    for (const [systemId, list] of bySystem) {
      list.sort((a, b) => a._id.localeCompare(b._id));
      const node = nodeMap[systemId];
      if (node === undefined) continue;
      const n = list.length;
      list.forEach((fleet, i) => {
        const angle = (i / n) * Math.PI * 2 - Math.PI / 2;
        markers.push({
          fleetId: fleet._id,
          originSystemId: systemId,
          x: node.x + Math.cos(angle) * FLEET_ORBIT_RADIUS,
          y: node.y + Math.sin(angle) * FLEET_ORBIT_RADIUS,
          colorHex: empireColors[fleet.empireId] ?? "#94a3b8",
        });
      });
    }
    return markers;
  }, [activeGame, fleets, nodeMap, empireColors]);

  const pendingSegments = useMemo<PendingSegmentModel[]>(() => {
    if (!activeGame || activeGame.status !== "running") return [];
    const markerByFleetId = Object.fromEntries(
      fleetMarkers.map((m) => [m.fleetId, m]),
    );
    return pendingOrders.flatMap((order) => {
      const start = markerByFleetId[order.fleetId];
      const end = nodeMap[order.targetSystemId];
      if (start === undefined || end === undefined) return [];
      return [
        {
          key: order.orderId,
          x1: start.x,
          y1: start.y,
          x2: end.x,
          y2: end.y,
        },
      ];
    });
  }, [activeGame, fleetMarkers, pendingOrders, nodeMap]);

  const routeSegments = useMemo((): RouteSegmentModel[] => {
    if (!activeGame || activeGame.status !== "running") return [];
    return garrisonRoutes.flatMap((route) => {
      if (!isAdmin && myEmpireId !== route.empireId) return [];
      const from = nodeMap[route.originSystemId];
      const to = nodeMap[route.destinationSystemId];
      if (from === undefined || to === undefined) return [];
      return [
        {
          routeId: route._id,
          originSystemId: route.originSystemId,
          destSystemId: route.destinationSystemId,
          x1: from.x,
          y1: from.y,
          x2: to.x,
          y2: to.y,
          dispatchPct: route.dispatchPct,
          enabled: route.enabled,
        },
      ];
    });
  }, [activeGame, garrisonRoutes, nodeMap, isAdmin, myEmpireId]);

  const enRouteGhosts = useMemo<EnRouteGhostModel[]>(() => {
    if (!activeGame || activeGame.status !== "running") return [];
    return fleets
      .filter(
        (f) =>
          f.status === "enRoute" &&
          f.destinationSystemId !== null &&
          f.dispatchedTurn !== undefined &&
          f.travelTurnsTotal !== undefined,
      )
      .map((f) => ({
        fleetId: f._id,
        originSystemId: f.originSystemId,
        destSystemId: f.destinationSystemId as string,
        strength: f.strength,
        colorHex: empireColors[f.empireId] ?? "#94a3b8",
        dispatchedTurn: f.dispatchedTurn as number,
        travelTurnsTotal: f.travelTurnsTotal as number,
      }));
  }, [activeGame, fleets, empireColors]);

  const selectedFleet = useMemo(
    () => fleets.find((f) => f._id === selectedFleetId),
    [fleets, selectedFleetId],
  );

  const selectedSystem = useMemo(
    () => systems.find((s) => s._id === selectedSystemId) ?? null,
    [systems, selectedSystemId],
  );

  const selectedNeighbors = useMemo(() => {
    if (selectedSystem === null) return [];
    const nameById = Object.fromEntries(systems.map((s) => [s._id, s.name]));
    const ids = new Set<string>();
    for (const link of links) {
      if (link.fromSystemId === selectedSystem._id) ids.add(link.toSystemId);
      if (link.toSystemId === selectedSystem._id) ids.add(link.fromSystemId);
    }
    return [...ids]
      .map((id) => ({ id, name: nameById[id] ?? id }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [selectedSystem, links, systems]);

  const cappedShipsToDispatch =
    selectedFleet !== undefined
      ? Math.min(Math.max(shipsToDispatch, 0), selectedFleet.strength)
      : shipsToDispatch;

  const onFleetMoveCommit = useCallback(
    async (payload: {
      fleetId: string;
      targetSystemId: string;
      shipCount: number;
      originSystemId: string;
      establishRecurring: boolean;
    }) => {
      if (!activeGame || activeGame.status !== "running") return;
      const fleet = fleets.find((f) => f._id === payload.fleetId);
      const strength = fleet?.strength ?? payload.shipCount;
      await issueFleetOrder({
        gameId: activeGame._id,
        fleetId: payload.fleetId as Id<"flt_fleets">,
        turnNumber: activeGame.currentTurn,
        orderType: "move",
        targetSystemId: payload.targetSystemId as Id<"gal_systems">,
        ...(strength > payload.shipCount ? { shipCount: payload.shipCount } : {}),
      });
      if (payload.establishRecurring) {
        const dispatchPct = Math.max(
          1,
          Math.min(100, Math.round((payload.shipCount / Math.max(1, strength)) * 100)),
        );
        await setGarrisonRoute({
          gameId: activeGame._id,
          originSystemId: payload.originSystemId as Id<"gal_systems">,
          destinationSystemId: payload.targetSystemId as Id<"gal_systems">,
          dispatchPct,
          enabled: true,
        });
      }
    },
    [activeGame, issueFleetOrder, fleets, setGarrisonRoute],
  );

  const editingRoute = useMemo(
    () =>
      routeEditorRouteId === null
        ? null
        : garrisonRoutes.find((r) => r._id === routeEditorRouteId) ?? null,
    [routeEditorRouteId, garrisonRoutes],
  );

  const showRouteEditor =
    editingRoute !== null &&
    activeGame?.status === "running" &&
    (isAdmin || editingRoute.empireId === myEmpireId);

  async function saveRouteEditor() {
    if (!activeGame || editingRoute === null) return;
    await setGarrisonRoute({
      gameId: activeGame._id,
      originSystemId: editingRoute.originSystemId,
      destinationSystemId: editingRoute.destinationSystemId,
      dispatchPct: routeEditorPct,
      enabled: routeEditorEnabled,
    });
  }

  async function clearRouteEditor() {
    if (!activeGame || editingRoute === null) return;
    await setGarrisonRoute({
      gameId: activeGame._id,
      originSystemId: editingRoute.originSystemId,
      destinationSystemId: null,
      dispatchPct: 0,
      enabled: false,
    });
    dismissRouteEditor();
  }

  const showFleetPanel =
    activeGame?.status === "running" &&
    selectedFleet !== undefined &&
    selectedFleet.status === "idle";

  return (
    <section className="relative overflow-hidden rounded-xl border border-st-border bg-st-panel p-2">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 px-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-st-muted">
          Galaxy Map
        </h2>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {activeGame ? (
            <div className="flex items-center gap-1">
              <Button
                variant="secondary"
                className="size-8 shrink-0 p-0"
                title="Zoom out"
                aria-label="Zoom out"
                type="button"
                onClick={() => zoomFromCenter(1 / MAP_BUTTON_ZOOM_FACTOR)}
              >
                <Minus className="size-4" aria-hidden />
              </Button>
              <Button
                variant="secondary"
                className="size-8 shrink-0 p-0"
                title="Zoom in"
                aria-label="Zoom in"
                type="button"
                onClick={() => zoomFromCenter(MAP_BUTTON_ZOOM_FACTOR)}
              >
                <Plus className="size-4" aria-hidden />
              </Button>
              <Button
                variant="secondary"
                className="size-8 shrink-0 p-0"
                title="Fit entire galaxy"
                aria-label="Fit entire galaxy"
                type="button"
                onClick={resetMapView}
              >
                <Expand className="size-4" aria-hidden />
              </Button>
            </div>
          ) : null}
          <span className="text-xs text-st-muted">
            {activeGame ? `${stageNodes.length} systems` : "Create + seed a game"}
          </span>
        </div>
      </div>
      <GalaxyStage
        camera={camera}
        onCameraChange={handleCameraChange}
        nodes={stageNodes}
        links={stageLinks}
        galaxyLinks={galaxyLinkRows}
        fleetMarkers={fleetMarkers}
        pendingSegments={pendingSegments}
        routeSegments={routeSegments}
        enRouteGhosts={enRouteGhosts}
        turnTimeline={turnTimeline}
        selectedFleetId={selectedFleetId}
        onSelectedFleetChange={handleSelectedFleetChange}
        shipsToDispatch={cappedShipsToDispatch}
        repeatNextDragEnabled={repeatNextDragEnabled}
        canIssueOrders={activeGame?.status === "running"}
        onFleetMoveCommit={activeGame?.status === "running" ? onFleetMoveCommit : undefined}
        onRouteMidpointTap={
          activeGame?.status === "running" && routeSegments.length > 0
            ? handleRouteMidpointTap
            : undefined
        }
        onStarPointerTap={activeGame ? handleStarTap : undefined}
        onStarDoubleTap={activeGame ? handleStarDoubleTap : undefined}
        onStageBackgroundTap={activeGame ? handleStageBackgroundTap : undefined}
      />
      {activeGame && selectedSystem !== null ? (
        <div className="pointer-events-auto absolute bottom-3 right-3 z-10 max-h-[min(60vh,420px)] max-w-[min(100%-1.5rem,300px)] overflow-y-auto rounded-lg border border-st-border bg-st-bg/95 px-3 py-2 text-sm shadow-lg backdrop-blur-sm">
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="font-medium leading-snug text-st-fg">
                {selectedSystem.name}
              </div>
              <div className="mt-0.5 font-mono text-xs text-st-muted">
                {selectedSystem.systemKey}
              </div>
            </div>
            <button
              type="button"
              className="shrink-0 text-xs text-st-muted underline hover:text-st-fg"
              onClick={dismissStarPanel}
            >
              Close
            </button>
          </div>
          <dl className="mt-3 space-y-2 text-xs">
            <div className="flex justify-between gap-3">
              <dt className="text-st-muted">Map position</dt>
              <dd className="font-mono text-st-fg">
                {Math.round(selectedSystem.x)}, {Math.round(selectedSystem.y)}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-st-muted">Resource richness</dt>
              <dd className="text-st-fg">
                {Math.round(selectedSystem.resourceRichness * 100)}%
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-st-muted">Homeworld</dt>
              <dd className="text-st-fg">
                {selectedSystem.isHomeworld ? "Yes" : "No"}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-st-muted">Owner</dt>
              <dd className="text-right text-st-fg">
                {selectedSystem.ownerEmpireId === null
                  ? "Independent"
                  : (empireNames[selectedSystem.ownerEmpireId] ?? "Unknown")}
              </dd>
            </div>
            <div>
              <dt className="text-st-muted">Hyperspace links</dt>
              <dd className="mt-1 text-st-fg">
                {selectedNeighbors.length === 0 ? (
                  <span className="text-st-muted">None</span>
                ) : (
                  <ul className="list-inside list-disc space-y-0.5">
                    {selectedNeighbors.map((n) => (
                      <li key={n.id}>{n.name}</li>
                    ))}
                  </ul>
                )}
              </dd>
            </div>
          </dl>
        </div>
      ) : null}
      {showFleetPanel ? (
        <div className="pointer-events-auto absolute bottom-3 left-3 z-10 max-w-[min(100%-1.5rem,280px)] rounded-lg border border-st-border bg-st-bg/95 px-3 py-2 text-sm shadow-lg backdrop-blur-sm">
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="font-medium text-st-fg">{selectedFleet.name}</div>
              <div className="mt-0.5 text-xs text-st-muted">
                {selectedFleet.strength}{" "}
                {selectedFleet.strength === 1 ? "ship" : "ships"} at system
              </div>
            </div>
            <button
              type="button"
              className="shrink-0 text-xs text-st-muted underline hover:text-st-fg"
              onClick={() => handleSelectedFleetChange(null)}
            >
              Clear
            </button>
          </div>
          <label className="mt-3 block text-xs text-st-muted">
            Ships to send on drag-drop move
            <div className="mt-1 flex items-center gap-2">
              <input
                type="range"
                min={0}
                max={selectedFleet.strength}
                value={cappedShipsToDispatch}
                onChange={(e) => setShipsToDispatch(Number(e.target.value))}
                className="min-w-0 flex-1 accent-cyan-400"
              />
              <button
                type="button"
                title={
                  repeatNextDragEnabled
                    ? "Recurring route on — drop sets automatic sends each turn"
                    : "Turn on to save this hop as a recurring route when you drop"
                }
                aria-label="Toggle recurring route on drag-drop"
                aria-pressed={repeatNextDragEnabled}
                disabled={cappedShipsToDispatch < 1}
                onClick={() => setRepeatNextDragEnabled((v) => !v)}
                className={`flex size-9 shrink-0 items-center justify-center rounded-md border transition-colors ${
                  repeatNextDragEnabled
                    ? "border-violet-400 bg-violet-500/20 text-violet-200"
                    : "border-st-border bg-st-panel text-st-muted hover:border-st-accent hover:text-st-fg"
                } disabled:cursor-not-allowed disabled:opacity-40`}
              >
                <Repeat2 className="size-4" aria-hidden />
              </button>
            </div>
            <div className="mt-1 font-mono text-xs text-st-fg">
              {cappedShipsToDispatch} of {selectedFleet.strength}
              {repeatNextDragEnabled && cappedShipsToDispatch >= 1 ? (
                <span className="ml-2 text-violet-300">
                  (
                  {Math.max(
                    1,
                    Math.min(
                      100,
                      Math.round(
                        (cappedShipsToDispatch / Math.max(1, selectedFleet.strength)) * 100,
                      ),
                    ),
                  )}
                  % recurring)
                </span>
              ) : null}
            </div>
          </label>
          {repeatNextDragEnabled && cappedShipsToDispatch >= 1 ? (
            <p className="mt-2 text-xs text-violet-300/90">
              Drop on a linked star to issue this move and save that hop as a{" "}
              <strong className="text-violet-200">standing route</strong> (
              {Math.max(
                1,
                Math.min(
                  100,
                  Math.round(
                    (cappedShipsToDispatch / Math.max(1, selectedFleet.strength)) * 100,
                  ),
                ),
              )}
              % of idle garrison each turn). Tap the violet dashed line to edit.
            </p>
          ) : null}
          {cappedShipsToDispatch < 1 ? (
            <p className="mt-2 text-xs text-amber-400/90">
              Set at least 1 ship to drag this fleet to a linked star.
            </p>
          ) : null}
        </div>
      ) : null}
      {showRouteEditor && editingRoute !== null ? (
        <div className="pointer-events-auto absolute bottom-3 left-1/2 z-10 max-w-[min(100%-1.5rem,340px)] -translate-x-1/2 rounded-lg border border-violet-500/40 bg-st-bg/95 px-3 py-2 text-sm shadow-lg backdrop-blur-sm">
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-violet-300">
                Recurring route
              </div>
              <div className="mt-1 font-medium text-st-fg">
                {systems.find((s) => s._id === editingRoute.originSystemId)?.name ??
                  "?"}{" "}
                →{" "}
                {systems.find((s) => s._id === editingRoute.destinationSystemId)?.name ??
                  "?"}
              </div>
            </div>
            <button
              type="button"
              className="shrink-0 text-xs text-st-muted underline hover:text-st-fg"
              onClick={dismissRouteEditor}
            >
              Close
            </button>
          </div>
          <label className="mt-3 block text-xs text-st-muted">
            Share of idle garrison each turn: {routeEditorPct}%
            <input
              type="range"
              min={0}
              max={100}
              value={routeEditorPct}
              onChange={(e) => setRouteEditorPct(Number(e.target.value))}
              className="mt-2 w-full accent-violet-400"
            />
          </label>
          <label className="mt-2 flex items-center gap-2 text-xs text-st-muted">
            <input
              type="checkbox"
              checked={routeEditorEnabled}
              onChange={(e) => setRouteEditorEnabled(e.target.checked)}
            />
            Route active
          </label>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              type="button"
              className="flex-1"
              disabled={routeEditorEnabled && routeEditorPct < 1}
              onClick={() => void saveRouteEditor()}
            >
              Apply
            </Button>
            <Button type="button" variant="secondary" onClick={() => void clearRouteEditor()}>
              Remove route
            </Button>
          </div>
          <p className="mt-2 text-[11px] leading-snug text-st-muted">
            Violet dashed lines show standing routes. Tap the dot on the line to open this panel.
          </p>
        </div>
      ) : null}
    </section>
  );
}
