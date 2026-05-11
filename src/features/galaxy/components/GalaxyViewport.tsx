import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { Expand, Info, Minus, Plus, Repeat2, Star } from "lucide-react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { formatPopulationPeople } from "@/lib/populationFormat";
import { Button } from "@/components/ui/button";
import {
  FLEET_ORBIT_RADIUS,
  GALAXY_STAGE_HEIGHT,
  GALAXY_STAGE_WIDTH,
  MAP_BUTTON_ZOOM_FACTOR,
  MAP_CAMERA_TWEEN_MS,
  MAX_MAP_SCALE,
  STAR_CLICK_RECENTER_FRACTION,
  STAR_CLICK_ZOOM_FRACTION,
} from "../constants";
import {
  clampMapScale,
  computeFitAllSystemsCamera,
  easeOutCubic,
  type GalaxyMapCamera,
} from "../utils/mapCamera";
import { useGalaxyData } from "../hooks/useGalaxyData";
import {
  GalaxyStage,
  type EnRouteGhostModel,
  type FleetMarkerModel,
  type FoodAlertNode,
  type GalaxyLink,
  type GalaxyNode,
  type PendingSegmentModel,
  type RouteSegmentModel,
  type StarvationNode,
  type TraderShipModel,
  type TurnTimelineModel,
} from "../pixi/GalaxyStage";
import type { GalaxyLinkRow } from "../utils/linkAdjacency";
import { gameAllowsPlayerOrders as gameAllowsOrders } from "@/features/sim/gameStatus";
import {
  equilibriumShipsPct,
  FOOD_PRICE_DEFAULT_CR,
  foodDemandForStockThresholds,
  foodProdDemandDisplay,
  foodStockpileBand,
  previewColonyFoodFlows,
} from "@/lib/simFoodEconomy";

export function GalaxyViewport() {
  const { activeGame, systems, links, empires, empireColors } = useGalaxyData();

  const simAllowsPlayerOrders = gameAllowsOrders(activeGame?.status);

  const fleetsQuery = useQuery(
    api.flt.queries.listFleetsForGame,
    activeGame ? { gameId: activeGame._id, limit: 200 } : "skip",
  );
  const fleets = useMemo(() => fleetsQuery ?? [], [fleetsQuery]);

  const pendingOrdersQuery = useQuery(
    api.flt.queries.listPendingMoveOrdersForTurn,
    simAllowsPlayerOrders && activeGame
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

  const activeTradersQuery = useQuery(
    api.eco.queries.listActiveTraders,
    activeGame ? { gameId: activeGame._id } : "skip",
  );
  const activeTraders = useMemo(() => activeTradersQuery ?? [], [activeTradersQuery]);

  const turnTimelineQuery = useQuery(
    api.sim.queries.getTurnTimelineForGame,
    activeGame ? { gameId: activeGame._id } : "skip",
  );
  const gameSettingsQuery = useQuery(
    api.admin.mutations.getGameSettings,
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
  const setEmphasis = useMutation(api.gal.mutations.setEmphasis);
  const adjustFoodImportSubsidy = useMutation(api.gal.mutations.adjustFoodImportSubsidy);

  const [selectedFleetId, setSelectedFleetId] = useState<string | null>(null);
  const [selectedTraderId, setSelectedTraderId] = useState<string | null>(null);
  const [selectedSystemId, setSelectedSystemId] = useState<string | null>(null);
  /** Local draft value for ships-effort slider (null = use server value). */
  const [localShipsPct, setLocalShipsPct] = useState<number | null>(null);
  const [emphasisCommitError, setEmphasisCommitError] = useState<string | null>(null);
  const [importSubsidyError, setImportSubsidyError] = useState<string | null>(null);
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

  useEffect(() => {
    setLocalShipsPct(null);
  }, [selectedSystemId]);

  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const [viewSize, setViewSize] = useState<{ width: number; height: number }>({
    width: GALAXY_STAGE_WIDTH,
    height: GALAXY_STAGE_HEIGHT,
  });
  const viewSizeRef = useRef(viewSize);
  useEffect(() => {
    viewSizeRef.current = viewSize;
  }, [viewSize]);

  useLayoutEffect(() => {
    const el = mapContainerRef.current;
    if (el === null) return;
    const measure = () => {
      const w = Math.round(el.clientWidth);
      const h = Math.round(el.clientHeight);
      if (w <= 0 || h <= 0) return;
      setViewSize((prev) => (prev.width === w && prev.height === h ? prev : { width: w, height: h }));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

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

  const selectedSystem = useMemo(
    () => systems.find((s) => s._id === selectedSystemId) ?? null,
    [systems, selectedSystemId],
  );

  const canEditEmphasis = useMemo(() => {
    if (!simAllowsPlayerOrders || selectedSystem === null) return false;
    if (isAdmin) return true;
    if (selectedSystem.ownerEmpireId === null) return false;
    return myRoles.some(
      (r) =>
        r.role === "empire" &&
        r.empireId !== null &&
        r.empireId === selectedSystem.ownerEmpireId,
    );
  }, [simAllowsPlayerOrders, selectedSystem, isAdmin, myRoles]);

  const emphasisSliderHint = useMemo(() => {
    if (selectedSystem === null) return null;
    if (!simAllowsPlayerOrders) {
      return "Production sliders apply while the game is running or paused and accepting orders.";
    }
    if (isAdmin) return null;
    if (selectedSystem.ownerEmpireId === null) {
      return "No colony yet — only a game admin can preset sliders until this world is claimed.";
    }
    const empireRole = myRoles.find((r) => r.role === "empire");
    if (!empireRole?.empireId) {
      if (myRoles.some((r) => r.role === "trader")) {
        return "Trader accounts cannot change colony production.";
      }
      if (myRoles.some((r) => r.role === "observer")) {
        return "Observers cannot change colony production.";
      }
      return "Join this game with an empire seat to manage colony sliders.";
    }
    if (empireRole.empireId !== selectedSystem.ownerEmpireId) {
      const name = empireNames[selectedSystem.ownerEmpireId] ?? "another faction";
      return `This colony belongs to ${name}. Only they — or a game admin — can change sliders here.`;
    }
    return null;
  }, [selectedSystem, simAllowsPlayerOrders, isAdmin, myRoles, empireNames]);

  const myEmpireId = useMemo(() => {
    const role = myRoles.find((r) => r.role === "empire");
    return role?.empireId ?? null;
  }, [myRoles]);

  const dismissStarPanel = useCallback(() => {
    setSelectedSystemId(null);
    setLocalShipsPct(null);
    setEmphasisCommitError(null);
    setImportSubsidyError(null);
  }, []);

  const dismissRouteEditor = useCallback(() => {
    setRouteEditorRouteId(null);
  }, []);

  const dismissTraderPanel = useCallback(() => {
    setSelectedTraderId(null);
  }, []);

  const handleStageBackgroundTap = useCallback(() => {
    dismissStarPanel();
    dismissRouteEditor();
    dismissTraderPanel();
  }, [dismissStarPanel, dismissRouteEditor, dismissTraderPanel]);

  const handleTraderSelect = useCallback((traderId: string | null) => {
    setSelectedTraderId(traderId);
    if (traderId !== null) {
      setSelectedSystemId(null);
      setSelectedFleetId(null);
      setRouteEditorRouteId(null);
    }
  }, []);

  const handleSelectedFleetChange = useCallback(
    (fleetId: string | null) => {
      setSelectedFleetId(fleetId);
      setSelectedTraderId(null);
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
      setSelectedTraderId(null);
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
      const { width, height } = viewSizeRef.current;
      setCamera(computeFitAllSystemsCamera(stageNodes, width, height));
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

  /**
   * Each click on a star pulses the camera one step closer to (centered-on-star, fully-zoomed),
   * with separate lerp fractions: centering snaps faster (so the star reaches the middle within
   * a click or two) while the zoom-in is a gentler series of pulses toward `MAX_MAP_SCALE`.
   */
  const handleStarTap = useCallback(
    (systemId: string) => {
      setSelectedSystemId(systemId);
      setEmphasisCommitError(null);
      setImportSubsidyError(null);
      setSelectedFleetId(null);
      setSelectedTraderId(null);
      setRouteEditorRouteId(null);
      const node = nodeMap[systemId];
      if (node === undefined) return;
      const cur = cameraRef.current;
      startCameraTweenTo({
        focusX: cur.focusX + (node.x - cur.focusX) * STAR_CLICK_RECENTER_FRACTION,
        focusY: cur.focusY + (node.y - cur.focusY) * STAR_CLICK_RECENTER_FRACTION,
        scale: clampMapScale(
          cur.scale + (MAX_MAP_SCALE - cur.scale) * STAR_CLICK_ZOOM_FRACTION,
        ),
      });
    },
    [nodeMap, startCameraTweenTo],
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
    const { width, height } = viewSizeRef.current;
    setCamera(computeFitAllSystemsCamera(stageNodes, width, height));
  }, [stageNodes, cancelCameraTween]);

  const fleetMarkers = useMemo<FleetMarkerModel[]>(() => {
    if (!simAllowsPlayerOrders) return [];
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
  }, [simAllowsPlayerOrders, fleets, nodeMap, empireColors]);

  const pendingSegments = useMemo<PendingSegmentModel[]>(() => {
    if (!simAllowsPlayerOrders) return [];
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
  }, [simAllowsPlayerOrders, fleetMarkers, pendingOrders, nodeMap]);

  const routeSegments = useMemo((): RouteSegmentModel[] => {
    if (!simAllowsPlayerOrders) return [];
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
  }, [simAllowsPlayerOrders, garrisonRoutes, nodeMap, isAdmin, myEmpireId]);

  const traderShips = useMemo((): TraderShipModel[] => {
    return activeTraders.map((t) => ({
      traderId: t._id,
      originSystemId: t.originSystemId,
      destSystemId: t.destinationSystemId,
      commodity: t.commodity,
      cargoUnits: t.cargoUnits,
      dispatchedTurn: t.dispatchedTurn,
      travelTurnsTotal: t.travelTurns,
      etaTurn: t.etaTurn,
      operatorKind:
        t.operatorKind === "player"
          ? "player"
          : t.operatorKind === "npc"
            ? "npc"
            : "unknown",
    }));
  }, [activeTraders]);

  const enRouteGhosts = useMemo<EnRouteGhostModel[]>(() => {
    if (!simAllowsPlayerOrders) return [];
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
  }, [simAllowsPlayerOrders, fleets, empireColors]);

  const foodAlerts = useMemo<FoodAlertNode[]>(() => {
    const alerts: FoodAlertNode[] = [];
    for (const s of systems) {
      const pop = s.population ?? 0;
      if (pop <= 0 || s.ownerEmpireId === null) continue;
      const f = s.emphasisFood ?? 34;
      const sh = s.emphasisShips ?? 33;
      const r = s.emphasisResearch ?? 33;
      const p = previewColonyFoodFlows({
        populationPeople: pop,
        resourceRichness: s.resourceRichness,
        baseProductivity: s.baseProductivity,
        emphasisFood: f,
        emphasisShips: sh,
        emphasisResearch: r,
        isHomeworld: s.isHomeworld,
        recentDamagePopulation: s.recentDamagePopulation,
      });
      const netPerTurn = p.netTotal;
      const stockFood = s.stockFood ?? 0;
      const turnsLeft = netPerTurn >= 0 ? Infinity : stockFood / Math.abs(netPerTurn);
      if (turnsLeft < 4) {
        const severity = Math.max(0, Math.min(1, 1 - turnsLeft / 4));
        alerts.push({ id: s._id, severity });
      }
    }
    return alerts;
  }, [systems]);

  const starvationAlerts = useMemo<StarvationNode[]>(() => {
    return systems
      .filter((s) => {
        const pop = s.population ?? 0;
        if (pop <= 0 || s.ownerEmpireId === null) return false;
        const stockFood = s.stockFood ?? 0;
        const f = s.emphasisFood ?? 34;
        const sh = s.emphasisShips ?? 33;
        const r = s.emphasisResearch ?? 33;
        const p = previewColonyFoodFlows({
          populationPeople: pop,
          resourceRichness: s.resourceRichness,
          baseProductivity: s.baseProductivity,
          emphasisFood: f,
          emphasisShips: sh,
          emphasisResearch: r,
          isHomeworld: s.isHomeworld,
          recentDamagePopulation: s.recentDamagePopulation,
        });
        return stockFood <= 0 && p.effectiveProdTotal < p.demandTotal;
      })
      .map((s) => ({ id: s._id }));
  }, [systems]);

  const selectedFleet = useMemo(
    () => fleets.find((f) => f._id === selectedFleetId),
    [fleets, selectedFleetId],
  );

  const selectedTrader = useMemo(() => {
    if (selectedTraderId === null) return undefined;
    return activeTraders.find((t) => t._id === selectedTraderId);
  }, [activeTraders, selectedTraderId]);

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
      if (!activeGame || !simAllowsPlayerOrders) return;
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
    [activeGame, simAllowsPlayerOrders, issueFleetOrder, fleets, setGarrisonRoute],
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
    simAllowsPlayerOrders &&
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
    simAllowsPlayerOrders &&
    selectedFleet !== undefined &&
    selectedFleet.status === "idle";

  const showTraderPanel = activeGame !== null && selectedTrader !== undefined;

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
      <div
        ref={mapContainerRef}
        className="relative w-full overflow-hidden rounded-lg"
        style={{ aspectRatio: `${GALAXY_STAGE_WIDTH} / ${GALAXY_STAGE_HEIGHT}` }}
      >
        <GalaxyStage
          viewWidth={viewSize.width}
          viewHeight={viewSize.height}
          camera={camera}
          onCameraChange={handleCameraChange}
          nodes={stageNodes}
          links={stageLinks}
          galaxyLinks={galaxyLinkRows}
          fleetMarkers={fleetMarkers}
          pendingSegments={pendingSegments}
          routeSegments={routeSegments}
          enRouteGhosts={enRouteGhosts}
          traderShips={traderShips}
          turnTimeline={turnTimeline}
          selectedFleetId={selectedFleetId}
          onSelectedFleetChange={handleSelectedFleetChange}
          selectedTraderId={selectedTraderId}
          onSelectedTraderChange={handleTraderSelect}
          shipsToDispatch={cappedShipsToDispatch}
          repeatNextDragEnabled={repeatNextDragEnabled}
          foodAlerts={foodAlerts}
          starvationAlerts={starvationAlerts}
          canIssueOrders={simAllowsPlayerOrders}
        onFleetMoveCommit={simAllowsPlayerOrders ? onFleetMoveCommit : undefined}
        onRouteMidpointTap={
          simAllowsPlayerOrders && routeSegments.length > 0
              ? handleRouteMidpointTap
              : undefined
          }
          onStarPointerTap={activeGame ? handleStarTap : undefined}
          onStarDoubleTap={activeGame ? handleStarTap : undefined}
          onStageBackgroundTap={activeGame ? handleStageBackgroundTap : undefined}
        />
      </div>
      {activeGame && selectedSystem !== null ? (
        <StarSystemPanel
          system={selectedSystem}
          empireNames={empireNames}
          selectedNeighbors={selectedNeighbors}
          canEdit={canEditEmphasis}
          emphasisHint={emphasisSliderHint}
          emphasisSaveError={emphasisCommitError}
          importSubsidyError={importSubsidyError}
          localShipsPct={localShipsPct}
          onLocalShipsPctChange={setLocalShipsPct}
          onShipsPctCommit={async (pct) => {
            if (!activeGame || !canEditEmphasis) return;
            setEmphasisCommitError(null);
            try {
              await setEmphasis({
                gameId: activeGame._id,
                systemId: selectedSystem._id,
                emphasisShips: pct,
              });
            } catch (e) {
              setEmphasisCommitError(
                e instanceof Error ? e.message : "Could not save production mix.",
              );
            }
          }}
          onImportSubsidyDelta={async (delta) => {
            if (!activeGame || !canEditEmphasis) return;
            setImportSubsidyError(null);
            try {
              await adjustFoodImportSubsidy({
                gameId: activeGame._id,
                systemId: selectedSystem._id as Id<"gal_systems">,
                delta,
              });
            } catch (e) {
              setImportSubsidyError(
                e instanceof Error ? e.message : "Could not update import offer.",
              );
            }
          }}
          onNeighborNavigate={handleStarTap}
          onClose={dismissStarPanel}
          foodStockpileMinPerPop={gameSettingsQuery?.foodStockpileMinPerPop ?? 0.5}
          foodStockpileMaxPerPop={gameSettingsQuery?.foodStockpileMaxPerPop ?? 3.0}
        />
      ) : null}
      {showTraderPanel && selectedTrader !== undefined && activeGame ? (
        <div className="pointer-events-auto absolute bottom-3 right-3 z-10 max-w-[min(100%-1.5rem,300px)] rounded-lg border border-amber-500/35 bg-st-bg/95 px-3 py-2 text-sm shadow-lg backdrop-blur-sm">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 space-y-1">
              <div className="truncate font-medium text-st-fg">
                {selectedTrader.captainDisplayName ?? traderDisplayName(selectedTrader)}
              </div>
              <div className="text-[11px] text-st-muted">
                {selectedTrader.operatorKind === "player"
                  ? "Player trader"
                  : selectedTrader.operatorKind === "npc"
                    ? "NPC trader"
                    : "Trader"}
                {selectedTrader.captainAffiliation ? (
                  <span className="block truncate text-st-muted/90">
                    {selectedTrader.captainAffiliation}
                  </span>
                ) : null}
              </div>
              <div className="text-xs text-st-fg">
                <span className="font-medium">
                  {systems.find((s) => s._id === selectedTrader.originSystemId)?.name ?? "?"}
                </span>
                <span className="mx-1 text-st-muted">&gt;</span>
                <span className="font-medium">
                  {systems.find((s) => s._id === selectedTrader.destinationSystemId)?.name ?? "?"}
                </span>
              </div>
              <div className="text-xs text-st-muted">
                Arriving in{" "}
                <span className="font-mono text-amber-200/90">
                  {Math.max(0, selectedTrader.etaTurn - activeGame.currentTurn)}
                </span>{" "}
                turn
                {Math.max(0, selectedTrader.etaTurn - activeGame.currentTurn) === 1 ? "" : "s"}
              </div>
              <div className="text-xs text-st-fg">
                <span className="text-st-muted">Cargo:</span>{" "}
                {selectedTrader.cargoUnits.toLocaleString()}{" "}
                <span className="capitalize">{selectedTrader.commodity}</span>
              </div>
            </div>
            <button
              type="button"
              className="shrink-0 text-xs text-st-muted underline hover:text-st-fg"
              onClick={() => handleTraderSelect(null)}
            >
              Close
            </button>
          </div>
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

function traderDisplayName(t: { commodity: string; _id: string }): string {
  const raw = t.commodity.trim();
  const label =
    raw.length === 0 ? "Cargo" : raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase();
  return `${label} freighter · ${t._id.slice(-4)}`;
}

// ---------------------------------------------------------------------------
// Star system info panel
// ---------------------------------------------------------------------------

const MAX_IMPORT_SUBSIDY_DISPLAY = 30;

type SystemDoc = {
  _id: string;
  name: string;
  systemKey: string;
  x: number;
  y: number;
  resourceRichness: number;
  baseProductivity?: number;
  isHomeworld: boolean;
  ownerEmpireId: string | null;
  population?: number;
  stockFood?: number;
  emphasisFood?: number;
  emphasisShips?: number;
  emphasisResearch?: number;
  foodPrice?: number;
  foodImportSubsidyPerUnit?: number;
  recentDamagePopulation?: number;
};

function StarSystemPanel({
  system,
  empireNames,
  selectedNeighbors,
  canEdit,
  emphasisHint,
  emphasisSaveError,
  importSubsidyError,
  localShipsPct,
  onLocalShipsPctChange,
  onShipsPctCommit,
  onImportSubsidyDelta,
  onNeighborNavigate,
  onClose,
  foodStockpileMinPerPop,
  foodStockpileMaxPerPop,
}: {
  system: SystemDoc;
  empireNames: Record<string, string>;
  selectedNeighbors: { id: string; name: string }[];
  canEdit: boolean;
  emphasisHint: string | null;
  emphasisSaveError: string | null;
  importSubsidyError: string | null;
  localShipsPct: number | null;
  onLocalShipsPctChange: (v: number) => void;
  onShipsPctCommit: (v: number) => Promise<void>;
  onImportSubsidyDelta: (delta: number) => Promise<void>;
  onNeighborNavigate: (systemId: string) => void;
  onClose: () => void;
  foodStockpileMinPerPop: number;
  foodStockpileMaxPerPop: number;
}) {
  const [importBonusInfoOpen, setImportBonusInfoOpen] = useState(false);
  const [homeworldInfoOpen, setHomeworldInfoOpen] = useState(false);
  const pop = system.population ?? 0;
  const stockFood = system.stockFood ?? 0;
  const emphasisResearch = system.emphasisResearch ?? 33;
  const emphasisShips = system.emphasisShips ?? 33;

  const sliderShips = localShipsPct ?? emphasisShips;
  const maxShips = Math.max(0, 100 - emphasisResearch);
  const currentFood = Math.max(0, 100 - Math.round(sliderShips) - emphasisResearch);

  const preview = previewColonyFoodFlows({
    populationPeople: pop,
    resourceRichness: system.resourceRichness,
    baseProductivity: system.baseProductivity,
    emphasisFood: currentFood,
    emphasisShips: Math.round(sliderShips),
    emphasisResearch,
    isHomeworld: system.isHomeworld,
    recentDamagePopulation: system.recentDamagePopulation,
  });

  const foodScores = foodProdDemandDisplay(preview);
  const foodScoreFmt = (n: number) => n.toFixed(1);

  const demandForStockBands = foodDemandForStockThresholds(preview);
  const stockBand = foodStockpileBand(
    stockFood,
    preview.demandTotal,
    foodStockpileMinPerPop,
    foodStockpileMaxPerPop,
  );
  const stockMinUnits = demandForStockBands * foodStockpileMinPerPop;
  const stockMaxUnits = demandForStockBands * foodStockpileMaxPerPop;
  const stockStatusTitle = `${Math.round(stockFood)} food units stored. Comfort band vs one-turn need: below ${stockMinUnits.toFixed(1)} is low; above ${stockMaxUnits.toFixed(1)} is oversupply.`;

  const turnsLeft =
    preview.netTotal >= 0 ? Infinity : stockFood / Math.abs(preview.netTotal);

  const eqShips = equilibriumShipsPct(system.resourceRichness, emphasisResearch, {
    baseProductivity: system.baseProductivity,
    isHomeworld: system.isHomeworld,
    recentDamagePopulation: system.recentDamagePopulation,
    populationPeople: pop,
  });

  const marketFoodCr = system.foodPrice;
  const importSubsidy = Math.max(0, system.foodImportSubsidyPerUnit ?? 0);
  const traderOfferCr = (marketFoodCr ?? FOOD_PRICE_DEFAULT_CR) + importSubsidy;

  const foodStatusColor =
    turnsLeft === Infinity ? "text-emerald-400" :
    turnsLeft > 3 ? "text-amber-300" :
    "text-red-400";

  const foodStatusLabel =
    turnsLeft === Infinity
      ? "Increasing"
      : turnsLeft > 3
        ? `${Math.floor(turnsLeft)} turns`
        : turnsLeft > 0
          ? `⚠ ${turnsLeft.toFixed(1)} turns`
          : "⛔ starving";

  return (
    <div className="pointer-events-auto absolute bottom-3 right-3 z-10 flex min-h-[min(38vh,360px)] max-h-[min(74vh,560px)] max-w-[min(100%-1.5rem,310px)] flex-col overflow-y-auto rounded-lg border border-st-border bg-st-bg/95 px-3 py-3 text-sm shadow-lg backdrop-blur-sm">
      {importBonusInfoOpen ? (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/55 p-4"
          role="presentation"
          onClick={() => setImportBonusInfoOpen(false)}
        >
          <div
            role="dialog"
            aria-labelledby="import-bonus-info-title"
            className="max-w-sm rounded-lg border border-st-border bg-st-panel p-4 text-sm text-st-fg shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="import-bonus-info-title" className="font-semibold text-st-fg">
              Import bonus
            </h2>
            <p className="mt-2 text-xs leading-relaxed text-st-muted">
              Bonus is paid from the empire&apos;s treasury when cargo arrives. If the treasury is empty,
              traders only receive the market price.
            </p>
            <Button type="button" variant="secondary" className="mt-4 w-full" onClick={() => setImportBonusInfoOpen(false)}>
              Close
            </Button>
          </div>
        </div>
      ) : null}
      {homeworldInfoOpen ? (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/55 p-4"
          role="presentation"
          onClick={() => setHomeworldInfoOpen(false)}
        >
          <div
            role="dialog"
            aria-labelledby="homeworld-info-title"
            className="max-w-sm rounded-lg border border-st-border bg-st-panel p-4 text-sm text-st-fg shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="homeworld-info-title" className="font-semibold text-st-fg">
              Homeworld
            </h2>
            <p className="mt-2 text-xs leading-relaxed text-st-muted">
              This system is an empire capital. Homeworlds receive stronger economic output from the same
              production mix (about +50% to local food output and to the productivity that drives ships and
              research here), collect higher taxes from the population (about +25%), and are treated as a
              last foothold when an empire collapses. In combat, defending fleets and infrastructure here get
              modest defensive bonuses compared with ordinary colonies.
            </p>
            <Button type="button" variant="secondary" className="mt-4 w-full" onClick={() => setHomeworldInfoOpen(false)}>
              Close
            </Button>
          </div>
        </div>
      ) : null}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <div className="font-medium leading-snug text-st-fg">{system.name}</div>
            {system.isHomeworld ? (
              <button
                type="button"
                title="Homeworld — what this means"
                aria-label="Homeworld information"
                className="inline-flex shrink-0 rounded p-0.5 text-amber-400/90 hover:bg-st-panel hover:text-amber-300"
                onClick={() => setHomeworldInfoOpen(true)}
              >
                <Star className="size-4 fill-current" aria-hidden />
              </button>
            ) : null}
          </div>
          <div className="mt-0.5 font-mono text-xs text-st-muted">{system.systemKey}</div>
        </div>
        <button
          type="button"
          className="shrink-0 text-xs text-st-muted underline hover:text-st-fg"
          onClick={onClose}
        >
          Close
        </button>
      </div>

      <dl className="mt-3 flex flex-1 flex-col space-y-2 text-xs">
        <div className="flex justify-between gap-3">
          <dt className="text-st-muted">Owner</dt>
          <dd className="text-right text-st-fg">
            {system.ownerEmpireId === null
              ? "Independent"
              : (empireNames[system.ownerEmpireId] ?? "Unknown")}
          </dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-st-muted">Resource richness</dt>
          <dd className="text-st-fg">{Math.round(system.resourceRichness * 100)}%</dd>
        </div>
        {pop > 0 && (
          <div className="flex justify-between gap-3">
            <dt className="text-st-muted">Population</dt>
            <dd className="font-mono text-st-fg">{formatPopulationPeople(pop)}</dd>
          </div>
        )}

        {/* Food status */}
        {pop > 0 && (
          <div className="rounded border border-st-border/60 bg-st-panel/50 px-2 py-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-st-muted">Food stock</span>
              <span
                className={`text-right font-medium ${
                  stockBand === "below"
                    ? "text-red-400"
                    : "text-emerald-400"
                }`}
                title={stockStatusTitle}
              >
                {stockBand === "below"
                  ? "Below Minimum"
                  : stockBand === "oversupply"
                    ? "Oversupply"
                    : "Acceptable"}
              </span>
            </div>
            <div className="mt-0.5 flex items-center justify-between gap-2">
              <span className="text-st-muted">Food surplus</span>
              <span className={`font-mono font-semibold ${foodStatusColor}`}>
                {foodStatusLabel}
              </span>
            </div>
            <div
              className="mt-1 flex items-center justify-between gap-2 text-xs"
              title="Production index vs need index. The second number is always 5 — your colony’s food need this turn on that scale. The first tracks local output; the value in parentheses is surplus (+) or shortfall (−)."
            >
              <span className="text-st-muted">Prod / demand</span>
              <span className="font-mono text-st-fg">
                {foodScoreFmt(foodScores.prod)} / {foodScoreFmt(foodScores.demand)}
                <span className={foodScores.net >= 0 ? "text-emerald-400" : "text-red-400"}>
                  {" "}
                  ({foodScores.net >= 0 ? "+" : ""}
                  {foodScoreFmt(foodScores.net)})
                </span>
              </span>
            </div>
          </div>
        )}

        {/* Food trade pricing (attracts importers) */}
        {pop > 0 && (
          <div className="rounded border border-st-border/60 bg-st-panel/50 px-2 py-1.5">
            <div className="text-[11px] font-medium text-st-muted">Food imports &amp; traders</div>
            <div className="mt-1 flex justify-between gap-2 text-xs">
              <span className="text-st-muted">Market food price</span>
              <span className="font-mono text-st-fg">
                {marketFoodCr !== undefined ? `${marketFoodCr.toFixed(1)} cr/u` : `— (≈${FOOD_PRICE_DEFAULT_CR} baseline until priced)`}
              </span>
            </div>
            <div className="mt-1 flex flex-wrap items-center justify-between gap-2 text-xs">
              <div className="flex items-center gap-1">
                <span className="text-st-muted">Import bonus</span>
                <button
                  type="button"
                  className="inline-flex rounded p-0.5 text-st-muted hover:bg-st-bg hover:text-st-fg"
                  title="How import bonus is paid"
                  aria-label="Import bonus information"
                  onClick={() => setImportBonusInfoOpen(true)}
                >
                  <Info className="size-3.5" aria-hidden />
                </button>
              </div>
              <div className="flex items-center gap-1">
                <Button
                  type="button"
                  variant="secondary"
                  className="size-7 shrink-0 p-0"
                  title="Lower bonus paid to food importers"
                  disabled={!canEdit || importSubsidy <= 0}
                  onClick={() => void onImportSubsidyDelta(-1)}
                >
                  <Minus className="size-3.5" aria-hidden />
                </Button>
                <span className="min-w-[2.5rem] text-center font-mono text-st-fg">{importSubsidy} cr/u</span>
                <Button
                  type="button"
                  variant="secondary"
                  className="size-7 shrink-0 p-0"
                  title="Raise bonus so traders earn more delivering here"
                  disabled={!canEdit || importSubsidy >= MAX_IMPORT_SUBSIDY_DISPLAY}
                  onClick={() => void onImportSubsidyDelta(1)}
                >
                  <Plus className="size-3.5" aria-hidden />
                </Button>
              </div>
            </div>
            <div className="mt-0.5 flex justify-between gap-2 text-xs">
              <span className="text-st-muted">Traders&apos; offered sell price</span>
              <span className="font-mono text-amber-200/90">{traderOfferCr.toFixed(1)} cr/u</span>
            </div>
            {importSubsidyError !== null ? (
              <p className="mt-1 text-[10px] text-red-400">{importSubsidyError}</p>
            ) : null}
          </div>
        )}

        {/* Ship production effort slider */}
        {pop > 0 && (
          <div className="rounded border border-st-border/60 bg-st-panel/50 px-2 py-1.5">
            <div className="mb-1 flex items-center justify-between gap-1">
              <span className="text-st-muted">Ship production effort</span>
              <span className="font-mono text-st-fg">{Math.round(sliderShips)}%</span>
            </div>
            <div className="relative">
              {/* Equilibrium marker */}
              <div
                className="pointer-events-none absolute top-0 h-full"
                style={{
                  left: `${maxShips > 0 ? (eqShips / maxShips) * 100 : 0}%`,
                }}
              >
                <div className="relative -translate-x-1/2">
                  <div className="h-4 w-0.5 bg-emerald-400/80" title="Food equilibrium" />
                </div>
              </div>
              <input
                type="range"
                min={0}
                max={maxShips}
                step={1}
                value={Math.round(sliderShips)}
                disabled={!canEdit}
                onChange={(e) => onLocalShipsPctChange(Number(e.target.value))}
                onMouseUp={(e) => {
                  if (!canEdit) return;
                  void onShipsPctCommit(Number((e.target as HTMLInputElement).value));
                }}
                onTouchEnd={(e) => {
                  if (!canEdit) return;
                  void onShipsPctCommit(Number((e.target as HTMLInputElement).value));
                }}
                className="w-full accent-cyan-400 disabled:opacity-50"
              />
            </div>
            <div className="mt-0.5 flex justify-between text-[10px] text-st-muted">
              <span>← more food</span>
              <span className="text-emerald-400/80">
                ▲{Math.round(eqShips)}% equilibrium
              </span>
              <span>more ships →</span>
            </div>
            <div className="mt-1 flex justify-between text-[10px]">
              <span className="text-st-muted">Food effort</span>
              <span className="font-mono text-st-fg">{currentFood}%</span>
            </div>
            {emphasisSaveError !== null ? (
              <p className="mt-1 text-[10px] text-red-400">{emphasisSaveError}</p>
            ) : !canEdit && emphasisHint !== null ? (
              <p className="mt-1 text-[10px] text-st-muted">{emphasisHint}</p>
            ) : null}
          </div>
        )}

        <div>
          <dt className="text-st-muted">Hyperspace links</dt>
          <dd className="mt-1 text-st-fg">
            {selectedNeighbors.length === 0 ? (
              <span className="text-st-muted">None</span>
            ) : (
              <ul className="list-inside list-disc space-y-0.5">
                {selectedNeighbors.map((n) => (
                  <li key={n.id}>
                    <button
                      type="button"
                      className="text-left text-cyan-300/90 underline decoration-cyan-500/40 underline-offset-2 hover:text-cyan-200"
                      onClick={() => onNeighborNavigate(n.id)}
                    >
                      {n.name}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </dd>
        </div>
      </dl>
    </div>
  );
}
