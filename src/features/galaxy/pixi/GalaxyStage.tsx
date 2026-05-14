import { Application, extend, useApplication, useTick } from "@pixi/react";
import type { FederatedPointerEvent } from "pixi.js";
import { Circle, Container, Graphics, Point } from "pixi.js";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  FLEET_ORBIT_RADIUS,
  MAP_PAN_DRAG_THRESHOLD_PX,
  MAP_WHEEL_ZOOM_SENSITIVITY,
  STAR_HIT_RADIUS,
  TRAVEL_ANIM_MS,
} from "@/features/galaxy/constants";
import {
  clampMapScale,
  easeOutCubic,
  type GalaxyMapCamera,
  screenToWorld,
  zoomCameraTowardScreenPoint,
} from "@/features/galaxy/utils/mapCamera";
import {
  type GalaxyLinkRow,
  systemsShareLink,
} from "@/features/galaxy/utils/linkAdjacency";
import { turnTravelProgress } from "@/features/galaxy/utils/turnTravelProgress";

extend({ Graphics, Container });

const STAR_VISUAL_DRAG_MAX_DISTANCE = STAR_HIT_RADIUS * 2;
const STAR_VISUAL_RETURN_MS = 2500;

export type GalaxyNode = {
  id: string;
  x: number;
  y: number;
  ownerColor: string;
  isPriority?: boolean;
};

/** Food shortage alert: severity 0–1 drives pulse speed (1 = critical, <1 turn of food). */
export type FoodAlertNode = { id: string; severity: number };
/** Starvation: population actively dying this turn (stockFood ≈ 0). */
export type StarvationNode = { id: string };

export type GalaxyLink = {
  fromId: string;
  toId: string;
};

type StarVisualOffset = {
  systemId: string;
  dx: number;
  dy: number;
};

export type FleetMarkerModel = {
  fleetId: string;
  empireId: string;
  originSystemId: string;
  x: number;
  y: number;
  colorHex: string;
};

export type ColonyShipMarkerModel = {
  colonyShipId: string;
  originSystemId: string;
  x: number;
  y: number;
  colorHex: string;
  /** When true, player may drag a multi-hop route from this idle ship's current system. */
  canDragDispatchRoute?: boolean;
};

export type ColonyShipRouteCommitPayload = {
  colonyShipId: string;
  routeSystemIds: string[];
};

export type PendingSegmentModel = {
  key: string;
  originSystemId?: string;
  targetSystemId?: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
};

/** Saved recurring garrison hop (star-center to star-center). */
export type RouteSegmentModel = {
  routeId: string;
  originSystemId: string;
  destSystemId: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  dispatchPct: number;
  enabled: boolean;
  /** Strategy-maintained routes use a muted line; manual standing orders stay vivid violet. */
  managedByStrategy?: boolean;
};

export type FleetMoveCommitPayload = {
  fleetId: string;
  targetSystemId: string;
  shipCount: number;
  originSystemId: string;
  establishRecurring: boolean;
};

export type EnRouteGhostModel = {
  fleetId: string;
  originSystemId: string;
  destSystemId: string;
  strength: number;
  colorHex: string;
  dispatchedTurn: number;
  travelTurnsTotal: number;
  etaTurn: number;
  /** When set, draw as colony transport instead of military chevron. */
  variant?: "fleet" | "colony";
};

/** Background or player trader ship shown in transit on the map. */
export type TraderShipModel = {
  traderId: string;
  originSystemId: string;
  destSystemId: string;
  commodity: string;
  cargoUnits: number;
  dispatchedTurn: number;
  travelTurnsTotal: number;
  etaTurn: number;
  operatorKind: "npc" | "player" | "unknown";
};

export type CombatMarkerModel = {
  battleId: string;
  systemId: string;
  attackerFleetId: string;
  defenderFleetId: string;
  attackerColorHex: string;
  defenderColorHex: string;
  attackerShips: number;
  defenderShips: number;
  attackerShipsAtStart: number;
  defenderShipsAtStart: number;
  attackerMotherships: number;
  defenderMotherships: number;
  phase: "opening" | "awaitingAttackerDecision" | "resolved";
  roundNumber: number;
  latestRound: CombatRoundReplayModel | null;
};

export type CombatRoundReplayModel = {
  turnNumber: number;
  attackerShipsBefore: number;
  defenderShipsBefore: number;
  attackerShipsAfter: number;
  defenderShipsAfter: number;
  mothershipEvents: MothershipDamageReplayModel[];
};

export type MothershipDamageReplayModel = {
  side: "attacker" | "defender";
  colonyShipId: string;
  name: string;
  damageApplied: number;
  damageBefore: number;
  damageAfter: number;
  destroyed: boolean;
};

export type TurnTimelineModel = {
  currentTurn: number;
  turnStartedAt: number | null;
  turnDurationMs: number;
};

export type GalaxyStageProps = {
  /** Logical CSS-pixel width of the canvas viewport (matches camera math screen space). */
  viewWidth: number;
  /** Logical CSS-pixel height of the canvas viewport (matches camera math screen space). */
  viewHeight: number;
  camera: GalaxyMapCamera;
  onCameraChange: (camera: GalaxyMapCamera) => void;
  nodes: GalaxyNode[];
  links: GalaxyLink[];
  galaxyLinks: GalaxyLinkRow[];
  fleetMarkers: FleetMarkerModel[];
  /** Non-combat colony ships at orbit (idle). */
  colonyShipMarkers: ColonyShipMarkerModel[];
  pendingSegments: PendingSegmentModel[];
  routeSegments: RouteSegmentModel[];
  enRouteGhosts: EnRouteGhostModel[];
  /** NPC / player traders in flight (cargo haulers). */
  traderShips: TraderShipModel[];
  /** Active ship battles taking place at star systems. */
  combatMarkers: CombatMarkerModel[];
  turnTimeline: TurnTimelineModel | null;
  selectedFleetId: string | null;
  onSelectedFleetChange: (fleetId: string | null) => void;
  selectedTraderId: string | null;
  onSelectedTraderChange: (traderId: string | null) => void;
  /** Selected star/system in the map. Drawn with a prominent pulsing highlight. */
  selectedSystemId: string | null;
  selectedColonyShipId: string | null;
  onSelectedColonyShipChange: (colonyShipId: string | null) => void;
  shipsToDispatch: number;
  /** When true, a successful drag-drop also establishes a recurring route (viewport handles save). */
  repeatNextDragEnabled: boolean;
  canIssueOrders: boolean;
  /**
   * When set, only fleets whose `empireId` passes this check can be selected or dragged.
   * Omitted = all fleets selectable (e.g. tests). Viewport passes player empire + admin bypass.
   */
  fleetSelectionAllowed?: (fleetEmpireId: string) => boolean;
  onFleetMoveCommit?: (payload: FleetMoveCommitPayload) => Promise<void>;
  onRouteMidpointTap?: (routeId: string) => void;
  onStarPointerTap?: (systemId: string) => void;
  /** Second click in a double-click; viewport typically tweens the camera to this system. */
  onStarDoubleTap?: (systemId: string) => void;
  /** Fires when the user taps empty map (no drag past threshold); dismiss overlays from viewport. */
  onStageBackgroundTap?: () => void;
  /** Systems with a food shortage. severity 0–1 drives pulse speed. */
  foodAlerts: FoodAlertNode[];
  /** Systems where population is actively dying from starvation. */
  starvationAlerts: StarvationNode[];
  onColonyShipRouteCommit?: (payload: ColonyShipRouteCommitPayload) => Promise<void>;
  /** Validate ordered destination system ids (first hop through final); return error or null. */
  validateColonyShipRoute?: (routeSystemIds: string[]) => string | null;
  /**
   * Deprecated no-ops — colony dispatch uses fleet-style drag only. Optional so stale Vite HMR
   * chunks or old call sites never reference undefined identifiers (runtime ReferenceError).
   */
  onColonyRouteDraftChange?: unknown;
  onColonyRouteDragActiveChange?: unknown;
  colonyRouteDismissNonce?: unknown;
};

export function GalaxyStage(props: GalaxyStageProps) {
  const safeW = Math.max(1, Math.round(props.viewWidth));
  const safeH = Math.max(1, Math.round(props.viewHeight));
  return (
    <Application
      width={safeW}
      height={safeH}
      background={"#080d1e"}
      antialias={true}
      autoDensity={true}
      resizeTo={undefined}
      className="block"
    >
      <GalaxyStageInner {...props} />
    </Application>
  );
}

function GalaxyStageInner({
  viewWidth,
  viewHeight,
  camera,
  onCameraChange,
  nodes,
  links,
  galaxyLinks,
  fleetMarkers,
  colonyShipMarkers,
  pendingSegments,
  routeSegments,
  enRouteGhosts,
  traderShips,
  combatMarkers,
  turnTimeline,
  selectedFleetId,
  onSelectedFleetChange,
  selectedTraderId,
  onSelectedTraderChange,
  selectedSystemId,
  selectedColonyShipId,
  onSelectedColonyShipChange,
  shipsToDispatch,
  repeatNextDragEnabled,
  canIssueOrders,
  fleetSelectionAllowed,
  onFleetMoveCommit,
  onRouteMidpointTap,
  onStarPointerTap,
  onStarDoubleTap,
  onStageBackgroundTap,
  foodAlerts,
  starvationAlerts,
  onColonyShipRouteCommit,
  validateColonyShipRoute,
  onColonyRouteDraftChange,
  onColonyRouteDragActiveChange,
  colonyRouteDismissNonce,
}: GalaxyStageProps) {
  void onColonyRouteDraftChange;
  void onColonyRouteDragActiveChange;
  void colonyRouteDismissNonce;

  const { app, isInitialised } = useApplication();
  /** Always read Pixi `app` from here in callbacks/effects — never put `app.canvas` / `app.renderer` in hook deps (React evaluates deps during render and those getters throw before init). */
  const appRef = useRef(app);

  /**
   * Logical viewport dimensions (CSS pixels). The parent owns the canvas size via ResizeObserver
   * and passes them in; we resize the Pixi renderer to match so `app.screen` always equals these
   * values, and all camera math stays consistent with what the user actually sees.
   */
  const viewW = Math.max(1, Math.round(viewWidth));
  const viewH = Math.max(1, Math.round(viewHeight));

  useEffect(() => {
    if (!isInitialised) return;
    const renderer = appRef.current.renderer;
    if (renderer === undefined) return;
    if (renderer.width !== viewW || renderer.height !== viewH) {
      renderer.resize(viewW, viewH);
    }
  }, [isInitialised, viewW, viewH]);

  const [dragFleetId, setDragFleetId] = useState<string | null>(null);
  const [dragCursorPos, setDragCursorPos] = useState<{ x: number; y: number } | null>(
    null,
  );
  const dragShipCountRef = useRef(1);
  const dragRecurringRef = useRef(false);

  const [dragColonyShipId, setDragColonyShipId] = useState<string | null>(null);

  const [starVisualOffset, setStarVisualOffsetState] = useState<StarVisualOffset | null>(null);
  const starVisualOffsetRef = useRef<StarVisualOffset | null>(null);
  const starReturnRafRef = useRef<number | null>(null);
  const starDragSuppressTapRef = useRef<{ systemId: string; until: number } | null>(null);

  const setStarVisualOffset = useCallback((next: StarVisualOffset | null) => {
    starVisualOffsetRef.current = next;
    setStarVisualOffsetState(next);
  }, []);

  const colonyDragPropsRef = useRef({
    nodes: [] as GalaxyNode[],
    galaxyLinks: [] as GalaxyLinkRow[],
    colonyShipMarkers: [] as ColonyShipMarkerModel[],
    onColonyShipRouteCommit: undefined as GalaxyStageProps["onColonyShipRouteCommit"],
    validateColonyShipRoute: undefined as GalaxyStageProps["validateColonyShipRoute"],
  });
  useEffect(() => {
    colonyDragPropsRef.current = {
      nodes,
      galaxyLinks,
      colonyShipMarkers,
      onColonyShipRouteCommit,
      validateColonyShipRoute,
    };
  }, [nodes, galaxyLinks, colonyShipMarkers, onColonyShipRouteCommit, validateColonyShipRoute]);

  const cameraRef = useRef(camera);
  const onCameraChangeRef = useRef(onCameraChange);
  const onStageBackgroundTapRef = useRef(onStageBackgroundTap);

  useEffect(() => {
    appRef.current = app;
    cameraRef.current = camera;
    onCameraChangeRef.current = onCameraChange;
    onStageBackgroundTapRef.current = onStageBackgroundTap;
  }, [app, camera, onCameraChange, onStageBackgroundTap]);

  type PanSession = {
    pointerId: number;
    startClientX: number;
    startClientY: number;
    startFocusX: number;
    startFocusY: number;
    dragging: boolean;
  };
  const panSessionRef = useRef<PanSession | null>(null);
  const panCleanupRef = useRef<(() => void) | null>(null);
  const pointerScratchRef = useRef(new Point());
  const panDeltaScratchRef = useRef({ cur: new Point(), origin: new Point() });

  type DragResolveSnapshot = Pick<
    GalaxyStageProps,
    "nodes" | "galaxyLinks" | "fleetMarkers" | "onFleetMoveCommit"
  >;
  const propsRef = useRef<DragResolveSnapshot>({
    nodes: [],
    galaxyLinks: [],
    fleetMarkers: [],
    onFleetMoveCommit: undefined,
  });
  useEffect(() => {
    propsRef.current = {
      nodes,
      galaxyLinks,
      fleetMarkers,
      onFleetMoveCommit,
    };
  }, [nodes, galaxyLinks, fleetMarkers, onFleetMoveCommit]);

  const clientToScreenPixels = useCallback(
    (clientX: number, clientY: number) => {
      const application = appRef.current;
      const events = application.renderer?.events;
      if (!isInitialised || events === undefined) {
        return { x: viewW / 2, y: viewH / 2 };
      }
      const p = pointerScratchRef.current;
      events.mapPositionToPoint(p, clientX, clientY);
      return { x: p.x, y: p.y };
    },
    [isInitialised, viewW, viewH],
  );

  const clientToWorld = useCallback(
    (clientX: number, clientY: number) => {
      const { x: sx, y: sy } = clientToScreenPixels(clientX, clientY);
      return screenToWorld(sx, sy, cameraRef.current, viewW, viewH);
    },
    [clientToScreenPixels, viewW, viewH],
  );

  const cancelStarReturnAnimation = useCallback(() => {
    if (starReturnRafRef.current !== null) {
      cancelAnimationFrame(starReturnRafRef.current);
      starReturnRafRef.current = null;
    }
  }, []);

  const startStarReturnAnimation = useCallback(
    (systemId: string, startDx: number, startDy: number) => {
      cancelStarReturnAnimation();
      const startAt = performance.now();

      const step = (now: number) => {
        const t = Math.min(1, (now - startAt) / STAR_VISUAL_RETURN_MS);
        const remaining = 1 - easeOutCubic(t);
        setStarVisualOffset({
          systemId,
          dx: startDx * remaining,
          dy: startDy * remaining,
        });

        if (t < 1) {
          starReturnRafRef.current = requestAnimationFrame(step);
        } else {
          starReturnRafRef.current = null;
          setStarVisualOffset(null);
        }
      };

      starReturnRafRef.current = requestAnimationFrame(step);
    },
    [cancelStarReturnAnimation, setStarVisualOffset],
  );

  const handleStarPointerDown = useCallback(
    (node: GalaxyNode, event: FederatedPointerEvent) => {
      if (event.pointerType === "mouse" && event.button !== 0) return;
      event.stopPropagation();
      cancelStarReturnAnimation();

      const startWorld = clientToWorld(event.clientX, event.clientY);
      const existingOffset =
        starVisualOffsetRef.current?.systemId === node.id
          ? starVisualOffsetRef.current
          : null;
      const startDx = existingOffset?.dx ?? 0;
      const startDy = existingOffset?.dy ?? 0;
      const pointerId = event.pointerId;
      const startClientX = event.clientX;
      const startClientY = event.clientY;
      let movedPastTapThreshold = false;

      const onMove = (ev: PointerEvent) => {
        if (ev.pointerId !== pointerId) return;
        const dragDist = Math.hypot(ev.clientX - startClientX, ev.clientY - startClientY);
        if (dragDist >= MAP_PAN_DRAG_THRESHOLD_PX) {
          movedPastTapThreshold = true;
        }

        const world = clientToWorld(ev.clientX, ev.clientY);
        const unclampedDx = startDx + world.x - startWorld.x;
        const unclampedDy = startDy + world.y - startWorld.y;
        const len = Math.hypot(unclampedDx, unclampedDy);
        const scale =
          len > STAR_VISUAL_DRAG_MAX_DISTANCE && len > 0
            ? STAR_VISUAL_DRAG_MAX_DISTANCE / len
            : 1;
        setStarVisualOffset({
          systemId: node.id,
          dx: unclampedDx * scale,
          dy: unclampedDy * scale,
        });
      };

      const onUp = (ev: PointerEvent) => {
        if (ev.pointerId !== pointerId) return;
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onUp);

        if (movedPastTapThreshold) {
          starDragSuppressTapRef.current = {
            systemId: node.id,
            until: performance.now() + 300,
          };
        }

        const latest = starVisualOffsetRef.current;
        if (latest?.systemId === node.id && Math.hypot(latest.dx, latest.dy) > 0.1) {
          startStarReturnAnimation(node.id, latest.dx, latest.dy);
        } else {
          setStarVisualOffset(null);
        }
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
    },
    [cancelStarReturnAnimation, clientToWorld, setStarVisualOffset, startStarReturnAnimation],
  );

  const handleStarPointerTap = useCallback(
    (node: GalaxyNode, event: FederatedPointerEvent) => {
      const suppressed = starDragSuppressTapRef.current;
      if (
        suppressed !== null &&
        suppressed.systemId === node.id &&
        performance.now() <= suppressed.until
      ) {
        starDragSuppressTapRef.current = null;
        event.stopPropagation();
        return;
      }

      if (onStarPointerTap === undefined && onStarDoubleTap === undefined) return;
      event.stopPropagation();
      const detail = (event.nativeEvent as PointerEvent | MouseEvent).detail ?? 0;
      if (detail >= 2 && onStarDoubleTap !== undefined) {
        onStarDoubleTap(node.id);
        return;
      }
      if (onStarPointerTap !== undefined) {
        onStarPointerTap(node.id);
      }
    },
    [onStarDoubleTap, onStarPointerTap],
  );

  useEffect(() => {
    if (!isInitialised) return;
    const application = appRef.current;
    const canvas = application.canvas;
    const events = application.renderer?.events;
    if (canvas === undefined || events === undefined) return;

    // Wheel zoom anchors on the world point under the cursor so players can hover over
    // a system and zoom toward it. mapPositionToPoint converts viewport client coords
    // into Pixi logical screen coords (matches our camera math).
    const p = new Point();
    const onWheel = (ev: WheelEvent) => {
      ev.preventDefault();
      events.mapPositionToPoint(p, ev.clientX, ev.clientY);
      const factor = Math.exp(-ev.deltaY * MAP_WHEEL_ZOOM_SENSITIVITY);
      const cam = cameraRef.current;
      const nextScale = clampMapScale(cam.scale * factor);
      const next = zoomCameraTowardScreenPoint(cam, p.x, p.y, nextScale, viewW, viewH);
      onCameraChangeRef.current(next);
    };

    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      canvas.removeEventListener("wheel", onWheel);
    };
  }, [isInitialised, viewW, viewH]);

  useEffect(() => {
    return () => {
      cancelStarReturnAnimation();
      panCleanupRef.current?.();
      panCleanupRef.current = null;
    };
  }, [cancelStarReturnAnimation]);

  const handleBackgroundPointerDown = useCallback(
    (event: FederatedPointerEvent) => {
      if (event.pointerType === "mouse" && event.button !== 0) return;
      const events = appRef.current.renderer?.events;
      if (events === undefined) return;
      panCleanupRef.current?.();
      panCleanupRef.current = null;

      const panSession: PanSession = {
        pointerId: event.pointerId,
        startClientX: event.clientX,
        startClientY: event.clientY,
        startFocusX: cameraRef.current.focusX,
        startFocusY: cameraRef.current.focusY,
        dragging: false,
      };
      panSessionRef.current = panSession;

      const scratch = panDeltaScratchRef.current;

      const onMove = (ev: PointerEvent) => {
        if (ev.pointerId !== panSession.pointerId || !isInitialised) return;
        events.mapPositionToPoint(scratch.cur, ev.clientX, ev.clientY);
        events.mapPositionToPoint(scratch.origin, panSession.startClientX, panSession.startClientY);
        const dSx = scratch.cur.x - scratch.origin.x;
        const dSy = scratch.cur.y - scratch.origin.y;
        const dragDist = Math.hypot(
          ev.clientX - panSession.startClientX,
          ev.clientY - panSession.startClientY,
        );
        if (!panSession.dragging && dragDist >= MAP_PAN_DRAG_THRESHOLD_PX) {
          panSession.dragging = true;
        }
        if (!panSession.dragging) return;
        const cam = cameraRef.current;
        onCameraChangeRef.current({
          focusX: panSession.startFocusX - dSx / cam.scale,
          focusY: panSession.startFocusY - dSy / cam.scale,
          scale: cam.scale,
        });
      };

      const onUp = (ev: PointerEvent) => {
        if (ev.pointerId !== panSession.pointerId) return;
        const dist = Math.hypot(
          ev.clientX - panSession.startClientX,
          ev.clientY - panSession.startClientY,
        );
        if (!panSession.dragging && dist < MAP_PAN_DRAG_THRESHOLD_PX) {
          onStageBackgroundTapRef.current?.();
        }
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onUp);
        panSessionRef.current = null;
        panCleanupRef.current = null;
      };

      panCleanupRef.current = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onUp);
        panSessionRef.current = null;
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
    },
    [isInitialised],
  );

  useEffect(() => {
    if (!dragFleetId || !isInitialised) return;

    const onMove = (ev: PointerEvent) => {
      setDragCursorPos(clientToWorld(ev.clientX, ev.clientY));
    };

    const onUp = (ev: PointerEvent) => {
      const {
        fleetMarkers: fm,
        galaxyLinks: gl,
        nodes: nd,
        onFleetMoveCommit: commit,
      } = propsRef.current;
      const { x, y } = clientToWorld(ev.clientX, ev.clientY);
      const dropSystemId = hitTestSystem(nd, x, y);
      const fleet = fm.find((marker) => marker.fleetId === dragFleetId);
      const shipCount = dragShipCountRef.current;
      const recurring = dragRecurringRef.current;

      void (async () => {
        if (
          fleet !== undefined &&
          shipCount >= 1 &&
          dropSystemId !== null &&
          dropSystemId !== fleet.originSystemId &&
          systemsShareLink(gl, fleet.originSystemId, dropSystemId) &&
          commit !== undefined
        ) {
          try {
            await commit({
              fleetId: fleet.fleetId,
              targetSystemId: dropSystemId,
              shipCount,
              originSystemId: fleet.originSystemId,
              establishRecurring: recurring,
            });
          } catch (error) {
            console.error(error);
          }
        }
      })();

      setDragFleetId(null);
      setDragCursorPos(null);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [dragFleetId, clientToWorld, isInitialised]);

  useEffect(() => {
    if (!dragColonyShipId || !isInitialised) return;

    const onMove = (ev: PointerEvent) => {
      setDragCursorPos(clientToWorld(ev.clientX, ev.clientY));
    };

    const onUp = (ev: PointerEvent) => {
      const {
        nodes: nd,
        galaxyLinks: gl,
        colonyShipMarkers: cms,
        onColonyShipRouteCommit: commit,
        validateColonyShipRoute: valFn,
      } = colonyDragPropsRef.current;
      const { x, y } = clientToWorld(ev.clientX, ev.clientY);
      const dropSystemId = hitTestSystem(nd, x, y);
      const marker = cms.find((m) => m.colonyShipId === dragColonyShipId);

      void (async () => {
        if (
          marker !== undefined &&
          dropSystemId !== null &&
          dropSystemId !== marker.originSystemId &&
          systemsShareLink(gl, marker.originSystemId, dropSystemId) &&
          commit !== undefined
        ) {
          const route = [dropSystemId];
          const err = valFn !== undefined ? valFn(route) : null;
          if (err !== null) {
            console.warn(err);
          } else {
            try {
              await commit({
                colonyShipId: marker.colonyShipId,
                routeSystemIds: route,
              });
            } catch (error) {
              console.error(error);
            }
          }
        }
      })();

      setDragColonyShipId(null);
      setDragCursorPos(null);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [dragColonyShipId, clientToWorld, isInitialised]);

  const handleColonyShipPointerDown = useCallback(
    (ship: ColonyShipMarkerModel, event: FederatedPointerEvent) => {
      if (!canIssueOrders) return;
      event.stopPropagation();
      onSelectedColonyShipChange(ship.colonyShipId);
      if (ship.canDragDispatchRoute === true && onColonyShipRouteCommit !== undefined) {
        setDragFleetId(null);
        setDragColonyShipId(ship.colonyShipId);
        const cam = cameraRef.current;
        const w = screenToWorld(event.global.x, event.global.y, cam, viewW, viewH);
        setDragCursorPos({ x: w.x, y: w.y });
      }
    },
    [
      viewW,
      viewH,
      canIssueOrders,
      onSelectedColonyShipChange,
      onColonyShipRouteCommit,
    ],
  );

  const fleetSelectable = useCallback(
    (fleet: FleetMarkerModel) =>
      fleetSelectionAllowed === undefined || fleetSelectionAllowed(fleet.empireId),
    [fleetSelectionAllowed],
  );

  const handleFleetPointerDown = useCallback(
    (fleet: FleetMarkerModel, event: FederatedPointerEvent) => {
      if (!canIssueOrders) return;
      if (!fleetSelectable(fleet)) {
        event.stopPropagation();
        return;
      }
      event.stopPropagation();
      onSelectedFleetChange(fleet.fleetId);
      const n = Math.max(0, Math.floor(shipsToDispatch));
      dragShipCountRef.current = n;
      dragRecurringRef.current = repeatNextDragEnabled;
      if (n < 1) {
        return;
      }
      setDragColonyShipId(null);
      setDragFleetId(fleet.fleetId);
      const cam = cameraRef.current;
      const w = screenToWorld(event.global.x, event.global.y, cam, viewW, viewH);
      setDragCursorPos({ x: w.x, y: w.y });
    },
    [
      viewW,
      viewH,
      canIssueOrders,
      fleetSelectable,
      onSelectedFleetChange,
      shipsToDispatch,
      repeatNextDragEnabled,
    ],
  );

  const visualNodes = useMemo(
    () => nodes.map((node) => nodeWithStarVisualOffset(node, starVisualOffset)),
    [nodes, starVisualOffset],
  );
  const visualFleetMarkers = useMemo(
    () =>
      fleetMarkers.map((fleet) => ({
        ...fleet,
        ...pointWithStarVisualOffset(
          fleet.x,
          fleet.y,
          fleet.originSystemId,
          starVisualOffset,
        ),
      })),
    [fleetMarkers, starVisualOffset],
  );
  const visualColonyShipMarkers = useMemo(
    () =>
      colonyShipMarkers.map((ship) => ({
        ...ship,
        ...pointWithStarVisualOffset(
          ship.x,
          ship.y,
          ship.originSystemId,
          starVisualOffset,
        ),
      })),
    [colonyShipMarkers, starVisualOffset],
  );
  const dragPreviewFleet =
    dragFleetId === null ? null : visualFleetMarkers.find((m) => m.fleetId === dragFleetId);
  const dragPreviewColony =
    dragColonyShipId === null
      ? null
      : visualColonyShipMarkers.find((m) => m.colonyShipId === dragColonyShipId);

  const readyCursor = canIssueOrders && shipsToDispatch >= 1;
  const selectedSystemNode =
    selectedSystemId === null
      ? undefined
      : visualNodes.find((node) => node.id === selectedSystemId);

  if (!isInitialised) {
    return null;
  }

  return (
    <>
      <pixiGraphics
        eventMode="static"
        draw={(graphics) => drawBackground(graphics, viewW, viewH)}
        onPointerDown={handleBackgroundPointerDown}
      />
      <pixiContainer
        x={viewW / 2}
        y={viewH / 2}
        pivot={{ x: camera.focusX, y: camera.focusY }}
        scale={camera.scale}
        eventMode="passive"
      >
        <pixiGraphics
          eventMode="none"
          draw={(graphics) => drawHyperlanes(graphics, visualNodes, links)}
        />
        <pixiGraphics
          eventMode="none"
          draw={(graphics) => drawRouteSegments(graphics, routeSegments, starVisualOffset)}
        />
        <pixiGraphics
          eventMode="none"
          draw={(graphics) => drawPendingSegments(graphics, pendingSegments, starVisualOffset)}
        />
        {visualNodes.map((node) => (
          <pixiGraphics
            key={`${node.id}:${node.ownerColor}`}
            eventMode="static"
            cursor={
              onStarPointerTap !== undefined || onStarDoubleTap !== undefined
                ? "pointer"
                : "default"
            }
            onPointerDown={(event: FederatedPointerEvent) => handleStarPointerDown(node, event)}
            onPointerTap={(event: FederatedPointerEvent) => handleStarPointerTap(node, event)}
            draw={(graphics) => drawStar(graphics, node)}
          />
        ))}
        <SelectedStarHighlightGraphics node={selectedSystemNode} />
        <pixiGraphics
          eventMode="none"
          draw={(graphics) => drawPriorityStarBookmarks(graphics, visualNodes)}
        />
        <StarAlertGraphics
          foodAlerts={foodAlerts}
          starvationAlerts={starvationAlerts}
          nodes={visualNodes}
        />
        <CombatAnimationGraphics
          combatMarkers={combatMarkers}
          nodes={visualNodes}
          turnTimeline={turnTimeline}
        />
        <EnRouteGhostGraphics
          ghosts={enRouteGhosts}
          nodes={visualNodes}
          turnTimeline={turnTimeline}
        />
        {traderShips.map((trader) => (
          <TraderShipMarker
            key={trader.traderId}
            trader={trader}
            nodes={visualNodes}
            turnTimeline={turnTimeline}
            selected={selectedTraderId === trader.traderId}
            onTap={() => {
              onSelectedTraderChange(trader.traderId);
            }}
          />
        ))}
        {visualFleetMarkers.map((fleet) => (
          <pixiGraphics
            key={`${fleet.fleetId}:${fleet.colorHex}`}
            eventMode={canIssueOrders ? "static" : "auto"}
            cursor={
              !fleetSelectable(fleet)
                ? "default"
                : readyCursor
                  ? "grab"
                  : canIssueOrders
                    ? "pointer"
                    : "default"
            }
            onPointerDown={(event: FederatedPointerEvent) =>
              handleFleetPointerDown(fleet, event)
            }
            draw={(graphics) =>
              drawFleetShip(
                graphics,
                fleet,
                visualNodes.find((node) => node.id === fleet.originSystemId),
                selectedFleetId === fleet.fleetId,
              )
            }
          />
        ))}
        {visualColonyShipMarkers.map((ship) => (
          <pixiGraphics
            key={`${ship.colonyShipId}:${ship.colorHex}`}
            eventMode={canIssueOrders ? "static" : "auto"}
            cursor={
              canIssueOrders && ship.canDragDispatchRoute === true && onColonyShipRouteCommit
                ? "grab"
                : canIssueOrders
                  ? "pointer"
                  : "default"
            }
            onPointerDown={(event: FederatedPointerEvent) =>
              handleColonyShipPointerDown(ship, event)
            }
            draw={(graphics) =>
              drawColonyShip(
                graphics,
                ship,
                visualNodes.find((node) => node.id === ship.originSystemId),
                selectedColonyShipId === ship.colonyShipId,
              )
            }
          />
        ))}
        {dragFleetId !== null &&
          dragCursorPos !== null &&
          dragPreviewFleet != null && (
            <pixiGraphics
              eventMode="none"
              draw={(graphics) => {
                graphics.clear();
                drawDashedPolyline(
                  graphics,
                  dragPreviewFleet.x,
                  dragPreviewFleet.y,
                  dragCursorPos.x,
                  dragCursorPos.y,
                  {
                    width: 2,
                    color: 0xfbbf24,
                    alpha: 0.95,
                    dash: 12,
                    gap: 8,
                  },
                );
                const dropSystemId = hitTestSystem(
                  visualNodes,
                  dragCursorPos.x,
                  dragCursorPos.y,
                );
                const shipCount = dragShipCountRef.current;
                if (
                  onFleetMoveCommit !== undefined &&
                  shipCount >= 1 &&
                  dropSystemId !== null &&
                  dropSystemId !== dragPreviewFleet.originSystemId &&
                  systemsShareLink(galaxyLinks, dragPreviewFleet.originSystemId, dropSystemId)
                ) {
                  const destNode = visualNodes.find((n) => n.id === dropSystemId);
                  if (destNode !== undefined) {
                    drawDashedCircle(graphics, destNode.x, destNode.y, 29, {
                      width: 4.5,
                      color: 0xfbbf24,
                      alpha: 0.95,
                      dash: 14,
                      gap: 10,
                    });
                  }
                }
              }}
            />
          )}
        {dragColonyShipId !== null &&
          dragCursorPos !== null &&
          dragPreviewColony != null && (
            <pixiGraphics
              eventMode="none"
              draw={(graphics) => {
                graphics.clear();
                drawDashedPolyline(
                  graphics,
                  dragPreviewColony.x,
                  dragPreviewColony.y,
                  dragCursorPos.x,
                  dragCursorPos.y,
                  {
                    width: 2,
                    color: 0x2dd4bf,
                    alpha: 0.95,
                    dash: 12,
                    gap: 8,
                  },
                );
              }}
            />
          )}
        {routeSegments.map((seg) => {
          const p1 = pointWithStarVisualOffset(
            seg.x1,
            seg.y1,
            seg.originSystemId,
            starVisualOffset,
          );
          const p2 = pointWithStarVisualOffset(
            seg.x2,
            seg.y2,
            seg.destSystemId,
            starVisualOffset,
          );
          const mx = (p1.x + p2.x) / 2;
          const my = (p1.y + p2.y) / 2;
          return (
            <pixiGraphics
              key={`route-hit-${seg.routeId}`}
              eventMode={onRouteMidpointTap !== undefined ? "static" : "none"}
              cursor={onRouteMidpointTap !== undefined ? "pointer" : "default"}
              onPointerTap={(event: FederatedPointerEvent) => {
                if (onRouteMidpointTap === undefined) return;
                event.stopPropagation();
                onRouteMidpointTap(seg.routeId);
              }}
              draw={(graphics) => {
                graphics.clear();
                graphics.circle(mx, my, 22).fill({ color: 0xffffff, alpha: 0.0001 });
                const { color, alpha } = garrisonRouteStrokeAppearance(seg);
                graphics.circle(mx, my, 5).stroke({ width: 2, color, alpha: alpha * 0.95 });
              }}
            />
          );
        })}
        {visualNodes.map((node) => (
          <pixiGraphics
            key={`star-hit-${node.id}`}
            eventMode="static"
            cursor="grab"
            onPointerDown={(event: FederatedPointerEvent) => handleStarPointerDown(node, event)}
            onPointerTap={(event: FederatedPointerEvent) => handleStarPointerTap(node, event)}
            draw={(graphics) => drawStarHitTarget(graphics, node)}
          />
        ))}
      </pixiContainer>
    </>
  );
}

// ---------------------------------------------------------------------------
// Food-shortage and starvation alert animations around stars
// ---------------------------------------------------------------------------

const ALERT_INNER_R = 22; // radius just outside the star ring
const ALERT_OUTER_R = 30;

function StarAlertGraphics({
  foodAlerts,
  starvationAlerts,
  nodes,
}: {
  foodAlerts: FoodAlertNode[];
  starvationAlerts: StarvationNode[];
  nodes: GalaxyNode[];
}) {
  const frameRef = useRef(0);
  const [, forceRender] = useState(0);
  useTick(() => {
    frameRef.current += 1;
    forceRender((x) => x + 1);
  });

  const draw = useCallback(
    (graphics: Graphics) => {
      graphics.clear();
      const now = Date.now();

      // — Food shortage: pulsing red arc ring around the star —
      for (const alert of foodAlerts) {
        const node = nodes.find((n) => n.id === alert.id);
        if (node === undefined) continue;
        // severity 0-1: pulse frequency 0.8 Hz (low) → 4 Hz (critical)
        const hz = 0.8 + alert.severity * 3.2;
        const alpha = 0.45 + 0.55 * Math.abs(Math.sin(now * 0.001 * hz * Math.PI));
        const width = 2.5 + alert.severity * 2;

        // Draw a broken arc ring in red segments
        const segments = 6;
        const gapFraction = 0.22;
        const segAngle = (Math.PI * 2) / segments;
        const drawAngle = segAngle * (1 - gapFraction);
        const r = ALERT_INNER_R + (ALERT_OUTER_R - ALERT_INNER_R) * 0.5;
        const rotOffset = now * 0.0003 * (1 + alert.severity); // slow rotation

        for (let i = 0; i < segments; i++) {
          const startA = i * segAngle + rotOffset;
          const endA = startA + drawAngle;
          const steps = 10;
          const pts: number[] = [];
          for (let s = 0; s <= steps; s++) {
            const a = startA + ((endA - startA) * s) / steps;
            pts.push(node.x + Math.cos(a) * r, node.y + Math.sin(a) * r);
          }
          if (pts.length >= 4) {
            graphics.moveTo(pts[0], pts[1]);
            for (let p = 2; p < pts.length; p += 2) {
              graphics.lineTo(pts[p], pts[p + 1]);
            }
            graphics.stroke({ width, color: 0xff3b30, alpha });
          }
        }

        // Small food grain dots at alternating arc gaps
        for (let i = 0; i < segments; i += 2) {
          const a = i * segAngle + drawAngle / 2 + rotOffset;
          const dr = ALERT_OUTER_R + 4;
          graphics
            .circle(node.x + Math.cos(a) * dr, node.y + Math.sin(a) * dr, 2.5)
            .fill({ color: 0xff6b6b, alpha: alpha * 0.9 });
        }
      }

      // — Starvation: red silhouette that fades in and out each second —
      for (const alert of starvationAlerts) {
        const node = nodes.find((n) => n.id === alert.id);
        if (node === undefined) continue;

        // Fade-in-hold-fade cycle: 1.8 s period
        const period = 1800;
        const phase = (now % period) / period;
        // 0-0.25 fade in, 0.25-0.65 hold, 0.65-1 fade out
        const alpha =
          phase < 0.25
            ? phase / 0.25
            : phase < 0.65
            ? 1
            : 1 - (phase - 0.65) / 0.35;

        // Draw a simple stick-figure orbiting the outer edge of the alert ring
        const orbitA = node.x !== undefined ? (now * 0.0004) % (Math.PI * 2) : 0;
        const cx = node.x + Math.cos(orbitA) * (ALERT_OUTER_R + 9);
        const cy = node.y + Math.sin(orbitA) * (ALERT_OUTER_R + 9);

        const figAlpha = alpha * 0.95;
        // head
        graphics.circle(cx, cy - 6, 2.5).fill({ color: 0xff3b30, alpha: figAlpha });
        // body line
        graphics
          .moveTo(cx, cy - 3.5)
          .lineTo(cx, cy + 3)
          .stroke({ width: 1.8, color: 0xff3b30, alpha: figAlpha });
        // arms
        graphics
          .moveTo(cx - 3, cy - 1)
          .lineTo(cx + 3, cy - 1)
          .stroke({ width: 1.8, color: 0xff3b30, alpha: figAlpha });
        // legs
        graphics
          .moveTo(cx, cy + 3)
          .lineTo(cx - 2.5, cy + 7)
          .stroke({ width: 1.8, color: 0xff3b30, alpha: figAlpha });
        graphics
          .moveTo(cx, cy + 3)
          .lineTo(cx + 2.5, cy + 7)
          .stroke({ width: 1.8, color: 0xff3b30, alpha: figAlpha });
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [foodAlerts, starvationAlerts, nodes, frameRef.current],
  );

  if (foodAlerts.length === 0 && starvationAlerts.length === 0) return null;
  return <pixiGraphics eventMode="none" draw={draw} />;
}

// ---------------------------------------------------------------------------
// Active star-system combat animation
// ---------------------------------------------------------------------------

const COMBAT_RING_R = 26;
/** Horizontal distance from star center to each fleet centroid (ties formations to the star). */
const COMBAT_FORMATION_X = 26;
/** Vertical separation so opposing fleets stack on distinct sides instead of overlapping. */
const COMBAT_FORMATION_Y_OFFSET = 11;
const COMBAT_FORMATION_COL_GAP = 6;
const COMBAT_FORMATION_ROW_GAP = 7;
const COMBAT_FORMATION_MAX_PER_ROW = 8;
const COMBAT_MAX_VISUAL_SHIPS_PER_SIDE = 24;
/** Shrinks fighter silhouettes and strokes together (50% vs prior art). */
const COMBAT_VISUAL_SCALE = 0.5;
/** Length past target so bolts read as overshooting the opposing line. */
const COMBAT_BEAM_OVERSHOOT = 14;
/** Bolt sweeps from shooter to target in ~this many ms (brief visible pulse). */
const COMBAT_BEAM_RIPPLE_DURATION_MS = 58;
/** Idle time before another bolt from the same side. */
const COMBAT_BEAM_RIPPLE_PERIOD_MS = 420;
/** Trailing segment length as a fraction of total shot length. */
const COMBAT_BEAM_RIPPLE_TRAIL_FRAC = 0.24;

type CombatShipToken = {
  scale: number;
};

function CombatAnimationGraphics({
  combatMarkers,
  nodes,
  turnTimeline,
}: {
  combatMarkers: CombatMarkerModel[];
  nodes: GalaxyNode[];
  turnTimeline: TurnTimelineModel | null;
}) {
  const [frame, setFrame] = useState(0);
  useTick(() => {
    if (combatMarkers.length === 0) return;
    setFrame((x) => x + 1);
  });

  const draw = useCallback(
    (graphics: Graphics) => {
      void frame;
      graphics.clear();
      const now = Date.now();

      for (const marker of combatMarkers) {
        const node = nodes.find((n) => n.id === marker.systemId);
        if (node === undefined) continue;

        drawCombatAtStar(graphics, node, marker, now, turnTimeline);
      }
    },
    [combatMarkers, nodes, turnTimeline, frame],
  );

  if (combatMarkers.length === 0) return null;
  return <pixiGraphics eventMode="none" draw={draw} />;
}

function drawCombatAtStar(
  graphics: Graphics,
  node: GalaxyNode,
  marker: CombatMarkerModel,
  now: number,
  turnTimeline: TurnTimelineModel | null,
) {
  const seed = stableHash(marker.battleId);
  const phaseOffset = (seed % 1000) / 1000;
  const seconds = now * 0.001 + phaseOffset * 4;
  const angle = seconds * 0.9;
  const volley = (Math.sin(seconds * Math.PI * 2.4) + 1) / 2;
  const counterVolley = (Math.sin(seconds * Math.PI * 2.4 + Math.PI) + 1) / 2;
  const clash = Math.max(volley, counterVolley);
  const ringPulse = (Math.sin(seconds * Math.PI * 2) + 1) / 2;

  const sparkAxisX = Math.cos(angle);
  const sparkAxisY = Math.sin(angle);
  const px = -sparkAxisY;
  const py = sparkAxisX;
  const attackerColor = hexColorToNumber(marker.attackerColorHex, 0xef4444);
  const defenderColor = hexColorToNumber(marker.defenderColorHex, 0x60a5fa);
  const attackerShipsDisplayed = interpolatedCombatShipCount({
    finalShips: marker.attackerShips,
    beforeShips: marker.latestRound?.attackerShipsBefore,
    afterShips: marker.latestRound?.attackerShipsAfter,
    replayTurn: marker.latestRound?.turnNumber,
    now,
    turnTimeline,
  });
  const defenderShipsDisplayed = interpolatedCombatShipCount({
    finalShips: marker.defenderShips,
    beforeShips: marker.latestRound?.defenderShipsBefore,
    afterShips: marker.latestRound?.defenderShipsAfter,
    replayTurn: marker.latestRound?.turnNumber,
    now,
    turnTimeline,
  });

  graphics.circle(node.x, node.y, COMBAT_RING_R + ringPulse * 5).stroke({
    width: 2.2 + ringPulse * 1.2,
    color: 0xf97316,
    alpha: 0.42 + ringPulse * 0.28,
  });

  for (let i = 0; i < 3; i += 1) {
    const sparkPhase = (seconds * 2.1 + i / 3) % 1;
    const sparkA = angle + Math.PI * 2 * (i / 3) + sparkPhase * 0.7;
    const sparkR = 16 + sparkPhase * 18;
    graphics
      .circle(node.x + Math.cos(sparkA) * sparkR, node.y + Math.sin(sparkA) * sparkR, 1.8)
      .fill({
        color: i % 2 === 0 ? attackerColor : defenderColor,
        alpha: 0.7 * (1 - sparkPhase),
      });
  }

  const attackerLead = drawCombatShipFormation(
    graphics,
    node,
    "attacker",
    attackerColor,
    attackerShipsDisplayed,
    Math.max(marker.attackerShipsAtStart, marker.latestRound?.attackerShipsBefore ?? 0),
    seconds,
  );
  const defenderLead = drawCombatShipFormation(
    graphics,
    node,
    "defender",
    defenderColor,
    defenderShipsDisplayed,
    Math.max(marker.defenderShipsAtStart, marker.latestRound?.defenderShipsBefore ?? 0),
    seconds + 0.35,
  );
  drawCombatMotherships(
    graphics,
    node,
    "attacker",
    attackerColor,
    marker.attackerMotherships,
    seconds,
  );
  drawCombatMotherships(
    graphics,
    node,
    "defender",
    defenderColor,
    marker.defenderMotherships,
    seconds + 0.35,
  );
  drawMothershipDetonations(graphics, node, marker, seconds, now, turnTimeline);

  const attackerPhaseMs = stableHash(`${marker.battleId}:atk`) % COMBAT_BEAM_RIPPLE_PERIOD_MS;
  const defenderPhaseMs =
    (stableHash(`${marker.battleId}:def`) %
      COMBAT_BEAM_RIPPLE_PERIOD_MS) +
    COMBAT_BEAM_RIPPLE_PERIOD_MS * 0.5;

  drawRippleFleetBolt(
    graphics,
    attackerLead.x,
    attackerLead.y,
    defenderLead.x,
    defenderLead.y,
    attackerColor,
    now,
    attackerPhaseMs,
  );
  drawRippleFleetBolt(
    graphics,
    defenderLead.x,
    defenderLead.y,
    attackerLead.x,
    attackerLead.y,
    defenderColor,
    now,
    defenderPhaseMs,
  );

  if (clash > 0.82) {
    const burst = (clash - 0.82) / 0.18;
    graphics.circle(node.x, node.y, 5 + burst * 12).fill({
      color: 0xfef3c7,
      alpha: 0.34 * (1 - burst * 0.35),
    });
    graphics.circle(node.x, node.y, 2.5 + burst * 5).fill({
      color: 0xffffff,
      alpha: 0.65 * (1 - burst * 0.4),
    });
  }

  // Small crossfire ticks make active combat readable even while zoomed out.
  graphics
    .moveTo(node.x - px * 11, node.y - py * 11)
    .lineTo(node.x + px * 11, node.y + py * 11)
    .stroke({ width: 1.2, color: 0xffffff, alpha: 0.18 + ringPulse * 0.16 });
}

function drawCombatMotherships(
  graphics: Graphics,
  node: GalaxyNode,
  side: "attacker" | "defender",
  color: number,
  count: number,
  seconds: number,
) {
  const visibleCount = Math.min(3, finiteVisualShipCount(count));
  if (visibleCount <= 0) return;
  const sideSign = side === "attacker" ? -1 : 1;
  const dirX = side === "attacker" ? 1 : -1;
  const blockY =
    side === "attacker" ? node.y - COMBAT_FORMATION_Y_OFFSET : node.y + COMBAT_FORMATION_Y_OFFSET;
  const fighterWall =
    COMBAT_FORMATION_X + COMBAT_FORMATION_COL_GAP * (COMBAT_FORMATION_MAX_PER_ROW - 1);
  const mothershipPastWall = fighterWall + 12;
  for (let i = 0; i < visibleCount; i += 1) {
    const x =
      side === "attacker"
        ? node.x - mothershipPastWall - i * 8
        : node.x + mothershipPastWall + i * 8;
    const y =
      blockY + (-sideSign) * i * 4 + Math.sin(seconds * 4 + i) * 0.85 * COMBAT_VISUAL_SCALE;
    drawColonyTransportSilhouette(graphics, x, y, dirX, 0, color, {
      selected: false,
      alpha: 0.95,
      strokeAlpha: 0.9,
      scale: 1.1 * COMBAT_VISUAL_SCALE,
    });
    const ringR = 15 * COMBAT_VISUAL_SCALE;
    graphics.circle(x, y, ringR).stroke({
      width: 1.4 * COMBAT_VISUAL_SCALE,
      color: 0xfef3c7,
      alpha: 0.42 + Math.sin(seconds * 5 + i) * 0.16,
    });
  }
}
function drawMothershipDetonations(
  graphics: Graphics,
  node: GalaxyNode,
  marker: CombatMarkerModel,
  seconds: number,
  now: number,
  turnTimeline: TurnTimelineModel | null,
) {
  const replayTurn = marker.latestRound?.turnNumber;
  if (
    replayTurn === undefined ||
    turnTimeline === null ||
    turnTimeline.turnStartedAt === null ||
    (replayTurn !== turnTimeline.currentTurn && replayTurn !== turnTimeline.currentTurn - 1)
  ) {
    return;
  }

  const durationMs = Math.max(1, turnTimeline.turnDurationMs);
  const progress = Math.max(0, Math.min(1, (now - turnTimeline.turnStartedAt) / durationMs));
  const destroyed = marker.latestRound?.mothershipEvents.filter((event) => event.destroyed) ?? [];
  const fighterWall =
    COMBAT_FORMATION_X + COMBAT_FORMATION_COL_GAP * (COMBAT_FORMATION_MAX_PER_ROW - 1);
  const mothershipPastWall = fighterWall + 12;
  destroyed.forEach((event, index) => {
    const sideSign = event.side === "attacker" ? -1 : 1;
    const blockY =
      event.side === "attacker"
        ? node.y - COMBAT_FORMATION_Y_OFFSET
        : node.y + COMBAT_FORMATION_Y_OFFSET;
    const x =
      event.side === "attacker"
        ? node.x - mothershipPastWall - index * 8
        : node.x + mothershipPastWall + index * 8;
    const y = blockY + (-sideSign) * index * 4;
    const pulse = (Math.sin(seconds * 9 + index) + 1) / 2;
    const alpha = Math.max(0, 1 - progress * 0.75);
    const radius = 11 + progress * 30 + pulse * 4;
    graphics.circle(x, y, radius).fill({
      color: 0xf97316,
      alpha: 0.24 * alpha,
    });
    graphics.circle(x, y, radius * 0.55).fill({
      color: 0xfef3c7,
      alpha: 0.34 * alpha,
    });
    graphics.circle(x, y, 4 + pulse * 5).fill({
      color: 0xffffff,
      alpha: 0.72 * alpha,
    });
    for (let i = 0; i < 7; i += 1) {
      const a = (Math.PI * 2 * i) / 7 + seconds * 0.6;
      const shardR = 8 + progress * 24 + i;
      graphics
        .moveTo(x + Math.cos(a) * 5, y + Math.sin(a) * 5)
        .lineTo(x + Math.cos(a) * shardR, y + Math.sin(a) * shardR)
        .stroke({ width: 1.4, color: 0xfde68a, alpha: 0.55 * alpha });
    }
  });
}

function interpolatedCombatShipCount({
  finalShips,
  beforeShips,
  afterShips,
  replayTurn,
  now,
  turnTimeline,
}: {
  finalShips: number;
  beforeShips: number | undefined;
  afterShips: number | undefined;
  replayTurn: number | undefined;
  now: number;
  turnTimeline: TurnTimelineModel | null;
}): number {
  const safeFinalShips = finiteVisualShipCount(finalShips);
  if (
    beforeShips === undefined ||
    afterShips === undefined ||
    replayTurn === undefined ||
    turnTimeline === null ||
    turnTimeline.turnStartedAt === null ||
    replayTurn !== turnTimeline.currentTurn &&
    replayTurn !== turnTimeline.currentTurn - 1
  ) {
    return safeFinalShips;
  }

  const durationMs = Math.max(1, turnTimeline.turnDurationMs);
  const progress = Math.max(0, Math.min(1, (now - turnTimeline.turnStartedAt) / durationMs));
  const displayed = beforeShips + (afterShips - beforeShips) * progress;
  return finiteVisualShipCount(displayed, safeFinalShips);
}

function drawCombatShipFormation(
  graphics: Graphics,
  node: GalaxyNode,
  side: "attacker" | "defender",
  color: number,
  shipCount: number,
  startingShipCount: number,
  seconds: number,
): { x: number; y: number } {
  const tokens = buildCombatShipTokens(shipCount, startingShipCount);
  const sideSign = side === "attacker" ? -1 : 1;
  const dirX = side === "attacker" ? 1 : -1;
  const leadX = node.x + sideSign * COMBAT_FORMATION_X;
  const leadY =
    side === "attacker" ? node.y - COMBAT_FORMATION_Y_OFFSET : node.y + COMBAT_FORMATION_Y_OFFSET;
  if (tokens.length === 0) {
    return { x: leadX, y: leadY };
  }

  const rowCount = Math.ceil(tokens.length / COMBAT_FORMATION_MAX_PER_ROW);
  tokens.forEach((token, index) => {
    const row = Math.floor(index / COMBAT_FORMATION_MAX_PER_ROW);
    const col = index % COMBAT_FORMATION_MAX_PER_ROW;
    const rowStart = row * COMBAT_FORMATION_MAX_PER_ROW;
    const rowSize = Math.min(
      COMBAT_FORMATION_MAX_PER_ROW,
      tokens.length - rowStart,
    );
    const x =
      leadX +
      sideSign * col * COMBAT_FORMATION_COL_GAP +
      Math.sin(seconds * 6 + index * 0.7) * 0.5;
    const y =
      leadY +
      (row - (rowCount - 1) / 2) * COMBAT_FORMATION_ROW_GAP +
      (col - (rowSize - 1) / 2) * 0.42 +
      Math.cos(seconds * 5 + index * 0.5) * 0.45;
    drawCombatShip(graphics, x, y, dirX, 0, color, token.scale);
  });

  return { x: leadX, y: leadY };
}

function buildCombatShipTokens(shipCount: number, startingShipCount: number): CombatShipToken[] {
  const current = finiteVisualShipCount(shipCount);
  if (current <= 0) return [];

  const starting = Math.max(current, finiteVisualShipCount(startingShipCount, current));
  const initialVisualShips =
    starting <= COMBAT_MAX_VISUAL_SHIPS_PER_SIDE
      ? starting
      : Math.min(COMBAT_MAX_VISUAL_SHIPS_PER_SIDE, Math.ceil(Math.sqrt(starting)));
  const visualShips = Math.max(
    1,
    Math.min(
      COMBAT_MAX_VISUAL_SHIPS_PER_SIDE,
      Math.ceil((current / Math.max(1, starting)) * initialVisualShips),
    ),
  );
  const shipsPerToken = current / visualShips;
  const scale =
    shipsPerToken >= 1000
      ? 1.15
      : shipsPerToken >= 100
        ? 0.92
        : shipsPerToken >= 10
          ? 0.68
          : 0.48;

  return Array.from({ length: visualShips }, () => ({ scale }));
}

function finiteVisualShipCount(value: number, fallback = 0): number {
  return Number.isFinite(value)
    ? Math.max(0, Math.floor(value))
    : Math.max(0, Math.floor(fallback));
}

function drawRippleFleetBolt(
  graphics: Graphics,
  xStart: number,
  yStart: number,
  xTarget: number,
  yTarget: number,
  color: number,
  nowMs: number,
  phaseShiftMs: number,
) {
  const dx = xTarget - xStart;
  const dy = yTarget - yStart;
  const lenBase = Math.hypot(dx, dy) || 1;
  const ux = dx / lenBase;
  const uy = dy / lenBase;
  const fullLen = lenBase + COMBAT_BEAM_OVERSHOOT;

  const shifted =
    (((nowMs + phaseShiftMs) % COMBAT_BEAM_RIPPLE_PERIOD_MS) + COMBAT_BEAM_RIPPLE_PERIOD_MS) %
    COMBAT_BEAM_RIPPLE_PERIOD_MS;
  const uLinear = shifted / COMBAT_BEAM_RIPPLE_DURATION_MS;
  if (uLinear >= 1) return;

  const envelope = (1 - uLinear) ** 1.45;
  const headDist = fullLen * uLinear;
  const rippleLen = Math.max(2.5, fullLen * COMBAT_BEAM_RIPPLE_TRAIL_FRAC);
  const tailDist = Math.max(0, headDist - rippleLen);

  const xT = xStart + ux * tailDist;
  const yT = yStart + uy * tailDist;
  const xH = xStart + ux * headDist;
  const yH = yStart + uy * headDist;

  const haloA = envelope * 0.24;
  const coreA = envelope * 0.98;
  graphics.moveTo(xT, yT).lineTo(xH, yH).stroke({
    width: 1.75,
    color,
    alpha: haloA,
    cap: "round",
  });
  graphics.moveTo(xT, yT).lineTo(xH, yH).stroke({
    width: 1,
    color: 0xffffff,
    alpha: coreA,
    cap: "round",
  });
}

function drawCombatShip(
  graphics: Graphics,
  x: number,
  y: number,
  dirx: number,
  diry: number,
  color: number,
  scale = 1,
) {
  const s = scale * COMBAT_VISUAL_SCALE;
  const len = Math.hypot(dirx, diry) || 1;
  const ox = dirx / len;
  const oy = diry / len;
  const px = -oy;
  const py = ox;
  const nose = 8.5 * s;
  const wing = 5.2 * s;
  const tail = 4.2 * s;
  const tipX = x + ox * nose;
  const tipY = y + oy * nose;
  const leftX = x + px * wing - ox * tail;
  const leftY = y + py * wing - oy * tail;
  const rightX = x - px * wing - ox * tail;
  const rightY = y - py * wing - oy * tail;

  graphics.poly([tipX, tipY, leftX, leftY, x - ox * 1.2 * s, y - oy * 1.2 * s, rightX, rightY]).fill({
    color,
    alpha: 0.92,
  });
  graphics
    .poly([tipX, tipY, leftX, leftY, x - ox * 1.2 * s, y - oy * 1.2 * s, rightX, rightY])
    .stroke({
      width: Math.max(0.85, 1.2 * s),
      color: 0xffffff,
      alpha: 0.75,
      join: "round",
    });
}

function hexColorToNumber(hex: string, fallback: number): number {
  const parsed = Number.parseInt(hex.replace("#", ""), 16);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function stableHash(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return hash;
}

function EnRouteGhostGraphics({
  ghosts,
  nodes,
  turnTimeline,
}: {
  ghosts: EnRouteGhostModel[];
  nodes: GalaxyNode[];
  turnTimeline: TurnTimelineModel | null;
}) {
  const [frame, setFrame] = useState(0);
  useTick(() => {
    setFrame((x) => x + 1);
  });

  const draw = useCallback(
    (graphics: Graphics) => {
      void frame;
      graphics.clear();
      const now = Date.now();
      const currentTurn = turnTimeline?.currentTurn ?? 0;
      const turnStartedAt = turnTimeline?.turnStartedAt ?? null;
      const travelAnimMs = Math.max(1, turnTimeline?.turnDurationMs ?? TRAVEL_ANIM_MS);

      for (const ghost of ghosts) {
        const from = nodes.find((n) => n.id === ghost.originSystemId);
        const to = nodes.find((n) => n.id === ghost.destSystemId);
        if (!from || !to) continue;

        const t = Math.max(1, ghost.travelTurnsTotal);
        const fraction = turnTravelProgress({
          now,
          currentTurn,
          dispatchedTurn: ghost.dispatchedTurn,
          etaTurn: ghost.etaTurn,
          travelTurnsTotal: t,
          turnStartedAt,
          turnDurationMs: travelAnimMs,
        });

        const gx = from.x + (to.x - from.x) * fraction;
        const gy = from.y + (to.y - from.y) * fraction;
        const ox = to.x - from.x;
        const oy = to.y - from.y;
        const len = Math.hypot(ox, oy) || 1;
        if (ghost.variant === "colony") {
          drawColonyShipGhost(graphics, gx, gy, ox / len, oy / len, ghost.colorHex);
        } else {
          drawFleetShipGhost(
            graphics,
            gx,
            gy,
            ox / len,
            oy / len,
            ghost.colorHex,
            ghost.strength,
          );
        }
      }
    },
    [ghosts, nodes, turnTimeline, frame],
  );

  return <pixiGraphics eventMode="none" draw={draw} />;
}

function TraderShipMarker({
  trader,
  nodes,
  turnTimeline,
  selected,
  onTap,
}: {
  trader: TraderShipModel;
  nodes: GalaxyNode[];
  turnTimeline: TurnTimelineModel | null;
  selected: boolean;
  onTap: () => void;
}) {
  const [frame, setFrame] = useState(0);
  useTick(() => {
    setFrame((x) => x + 1);
  });

  const draw = useCallback(
    (graphics: Graphics) => {
      void frame;
      graphics.clear();
      const now = Date.now();
      const currentTurn = turnTimeline?.currentTurn ?? 0;
      const turnStartedAt = turnTimeline?.turnStartedAt ?? null;
      const travelAnimMs = Math.max(1, turnTimeline?.turnDurationMs ?? TRAVEL_ANIM_MS);

      const from = nodes.find((n) => n.id === trader.originSystemId);
      const to = nodes.find((n) => n.id === trader.destSystemId);
      if (!from || !to) return;

      const t = Math.max(1, trader.travelTurnsTotal);
      const fraction = turnTravelProgress({
        now,
        currentTurn,
        dispatchedTurn: trader.dispatchedTurn,
        etaTurn: trader.etaTurn,
        travelTurnsTotal: t,
        turnStartedAt,
        turnDurationMs: travelAnimMs,
      });

      const gx = from.x + (to.x - from.x) * fraction;
      const gy = from.y + (to.y - from.y) * fraction;
      const ox = to.x - from.x;
      const oy = to.y - from.y;
      const len = Math.hypot(ox, oy) || 1;
      drawTraderShip(graphics, gx, gy, ox / len, oy / len, selected);
      graphics.hitArea = new Circle(gx, gy, 18);
    },
    [trader, nodes, turnTimeline, selected, frame],
  );

  return (
    <pixiGraphics
      eventMode="static"
      cursor="pointer"
      onPointerDown={(event: FederatedPointerEvent) => {
        event.stopPropagation();
      }}
      onPointerTap={(event: FederatedPointerEvent) => {
        event.stopPropagation();
        onTap();
      }}
      draw={draw}
    />
  );
}

function hitTestSystem(nodes: GalaxyNode[], x: number, y: number): string | null {
  const dropRadius = FLEET_ORBIT_RADIUS + 18;
  let best: { id: string; d2: number } | null = null;
  for (const node of nodes) {
    const dx = node.x - x;
    const dy = node.y - y;
    const d2 = dx * dx + dy * dy;
    if (d2 <= dropRadius * dropRadius && (best === null || d2 < best.d2)) {
      best = { id: node.id, d2 };
    }
  }
  return best?.id ?? null;
}

function pointWithStarVisualOffset(
  x: number,
  y: number,
  systemId: string | undefined,
  offset: StarVisualOffset | null,
): { x: number; y: number } {
  if (systemId === undefined || offset === null || offset.systemId !== systemId) {
    return { x, y };
  }
  return { x: x + offset.dx, y: y + offset.dy };
}

function nodeWithStarVisualOffset(node: GalaxyNode, offset: StarVisualOffset | null): GalaxyNode {
  if (offset === null || offset.systemId !== node.id) return node;
  return { ...node, x: node.x + offset.dx, y: node.y + offset.dy };
}

function drawBackground(graphics: Graphics, width: number, height: number) {
  graphics.clear();
  graphics.rect(0, 0, width, height).fill(0x080d1e);
}

function drawHyperlanes(
  graphics: Graphics,
  nodes: GalaxyNode[],
  galaxyLinks: GalaxyLink[],
) {
  graphics.clear();
  for (const link of galaxyLinks) {
    const from = nodes.find((node) => node.id === link.fromId);
    const to = nodes.find((node) => node.id === link.toId);
    if (!from || !to) continue;
    graphics
      .moveTo(from.x, from.y)
      .lineTo(to.x, to.y)
      .stroke({ width: 2, color: 0x334155, alpha: 0.85 });
  }
}

/** Manual standing route (enabled) — vivid violet; strategy automation uses grey-violet. */
const GARRISON_ROUTE_MANUAL_ENABLED = 0xc084fc;
const GARRISON_ROUTE_STRATEGY_ENABLED = 0xa89bb0;
const GARRISON_ROUTE_DISABLED = 0x64748b;

function garrisonRouteStrokeAppearance(
  segment: Pick<RouteSegmentModel, "enabled" | "managedByStrategy">,
): { color: number; alpha: number } {
  if (!segment.enabled) {
    return { color: GARRISON_ROUTE_DISABLED, alpha: 0.45 };
  }
  if (segment.managedByStrategy === true) {
    return { color: GARRISON_ROUTE_STRATEGY_ENABLED, alpha: 0.88 };
  }
  return { color: GARRISON_ROUTE_MANUAL_ENABLED, alpha: 0.88 };
}

function drawRouteSegments(
  graphics: Graphics,
  segments: RouteSegmentModel[],
  starVisualOffset: StarVisualOffset | null,
) {
  graphics.clear();
  for (const segment of segments) {
    const p1 = pointWithStarVisualOffset(
      segment.x1,
      segment.y1,
      segment.originSystemId,
      starVisualOffset,
    );
    const p2 = pointWithStarVisualOffset(
      segment.x2,
      segment.y2,
      segment.destSystemId,
      starVisualOffset,
    );
    const { color, alpha } = garrisonRouteStrokeAppearance(segment);
    drawDashedPolyline(graphics, p1.x, p1.y, p2.x, p2.y, {
      width: 2,
      color,
      alpha,
      dash: 11,
      gap: 9,
    });
  }
}

function drawPendingSegments(
  graphics: Graphics,
  segments: PendingSegmentModel[],
  starVisualOffset: StarVisualOffset | null,
) {
  graphics.clear();
  for (const segment of segments) {
    const p1 = pointWithStarVisualOffset(
      segment.x1,
      segment.y1,
      segment.originSystemId,
      starVisualOffset,
    );
    const p2 = pointWithStarVisualOffset(
      segment.x2,
      segment.y2,
      segment.targetSystemId,
      starVisualOffset,
    );
    drawDashedPolyline(
      graphics,
      p1.x,
      p1.y,
      p2.x,
      p2.y,
      {
        width: 2,
        color: 0xfbbf24,
        alpha: 0.85,
        dash: 10,
        gap: 7,
      },
    );
  }
}

function drawStar(graphics: Graphics, node: GalaxyNode) {
  graphics.clear();
  const fillColor = Number.parseInt(node.ownerColor.replace("#", ""), 16);
  graphics.circle(node.x, node.y, 14).fill(fillColor);
  graphics.circle(node.x, node.y, 19).stroke({ width: 3, color: 0xe2e8f0, alpha: 0.8 });
  graphics.hitArea = new Circle(node.x, node.y, STAR_HIT_RADIUS);
}

function drawPriorityStarBookmarks(graphics: Graphics, nodes: GalaxyNode[]) {
  graphics.clear();
  for (const node of nodes) {
    if (node.isPriority !== true) continue;
    const outer = 5;
    const inner = 2.2;
    const points: number[] = [];
    for (let i = 0; i < 10; i++) {
      const radius = i % 2 === 0 ? outer : inner;
      const angle = -Math.PI / 2 + (i * Math.PI) / 5;
      points.push(node.x + Math.cos(angle) * radius, node.y + Math.sin(angle) * radius);
    }
    graphics
      .poly(points)
      .fill({ color: 0x000000, alpha: 0.9 });
  }
}

function drawStarHitTarget(graphics: Graphics, node: GalaxyNode) {
  graphics.clear();
  graphics.circle(node.x, node.y, STAR_HIT_RADIUS).fill({ color: 0xffffff, alpha: 0.0001 });
  graphics.hitArea = new Circle(node.x, node.y, STAR_HIT_RADIUS);
}

function SelectedStarHighlightGraphics({ node }: { node: GalaxyNode | undefined }) {
  const [frame, setFrame] = useState(0);
  useTick(() => {
    setFrame((x) => x + 1);
  });

  const draw = useCallback(
    (graphics: Graphics) => {
      void frame;
      graphics.clear();
      if (node === undefined) return;

      const fillColor = Number.parseInt(node.ownerColor.replace("#", ""), 16);
      const pulse = (Math.sin(Date.now() * 0.0022) + 1) / 2;
      const glowRadius = 44 + pulse * 12;
      const coreRadius = 15 + pulse * 2.5;

      graphics.circle(node.x, node.y, glowRadius).fill({
        color: fillColor,
        alpha: 0.12 + pulse * 0.08,
      });
      graphics.circle(node.x, node.y, glowRadius * 0.68).fill({
        color: fillColor,
        alpha: 0.18 + pulse * 0.08,
      });
      graphics.circle(node.x, node.y, coreRadius).fill({
        color: fillColor,
        alpha: 0.98,
      });
      graphics.circle(node.x, node.y, 25 + pulse * 4).stroke({
        width: 3,
        color: 0xffffff,
        alpha: 0.65 + pulse * 0.25,
      });
    },
    [frame, node],
  );

  if (node === undefined) return null;
  return <pixiGraphics eventMode="none" draw={draw} />;
}

/** Colony transport: sleek “sleeper ship” silhouette (non-combat). */
function drawColonyShip(
  graphics: Graphics,
  ship: ColonyShipMarkerModel,
  homeNode: GalaxyNode | undefined,
  selected: boolean,
) {
  graphics.clear();
  const fx = ship.x;
  const fy = ship.y;
  const sx = homeNode?.x ?? fx;
  const sy = homeNode?.y ?? fy;
  const vx = fx - sx;
  const vy = fy - sy;
  const len = Math.hypot(vx, vy) || 1;
  const ox = vx / len;
  const oy = vy / len;
  const fillColor = Number.parseInt(ship.colorHex.replace("#", ""), 16);
  drawColonyTransportSilhouette(graphics, fx, fy, ox, oy, fillColor, {
    selected,
    alpha: 0.94,
    strokeAlpha: 1,
    scale: 1,
  });
  graphics.hitArea = new Circle(fx, fy, 20);
}

function drawFleetShip(
  graphics: Graphics,
  fleet: FleetMarkerModel,
  homeNode: GalaxyNode | undefined,
  selected: boolean,
) {
  graphics.clear();
  const fx = fleet.x;
  const fy = fleet.y;
  const sx = homeNode?.x ?? fx;
  const sy = homeNode?.y ?? fy;
  const vx = fx - sx;
  const vy = fy - sy;
  const len = Math.hypot(vx, vy) || 1;
  const ox = vx / len;
  const oy = vy / len;
  const px = -oy;
  const py = ox;
  const wing = 7;
  const nose = 11;
  const xTip = fx + ox * nose;
  const yTip = fy + oy * nose;
  const xLeft = fx + px * wing - ox * wing * 0.35;
  const yLeft = fy + py * wing - oy * wing * 0.35;
  const xRight = fx - px * wing - ox * wing * 0.35;
  const yRight = fy - py * wing - oy * wing * 0.35;
  const fillColor = Number.parseInt(fleet.colorHex.replace("#", ""), 16);
  graphics.poly([xTip, yTip, xLeft, yLeft, xRight, yRight]).fill(fillColor);
  if (selected) {
    graphics
      .poly([xTip, yTip, xLeft, yLeft, xRight, yRight])
      .stroke({ width: 2.5, color: 0xffffff, alpha: 1, join: "round" });
  }
}

/** Compact hauler icon for NPC/player traders (distinct from military fleet chevrons). */
function drawTraderShip(
  graphics: Graphics,
  fx: number,
  fy: number,
  dirx: number,
  diry: number,
  selected: boolean,
) {
  const ox = dirx;
  const oy = diry;
  const px = -oy;
  const py = ox;
  const hull = 8;
  const beam = 5;
  const xBow = fx + ox * hull;
  const yBow = fy + oy * hull;
  const xStern = fx - ox * hull * 0.55;
  const yStern = fy - oy * hull * 0.55;
  const xPort = fx + px * beam - ox * 2;
  const yPort = fy + py * beam - oy * 2;
  const xStar = fx - px * beam - ox * 2;
  const yStar = fy - py * beam - oy * 2;
  const fill = 0xf59e0b;
  graphics.poly([xBow, yBow, xPort, yPort, xStern, yStern, xStar, yStar]).fill({
    color: fill,
    alpha: 0.92,
  });
  graphics
    .poly([xBow, yBow, xPort, yPort, xStern, yStern, xStar, yStar])
    .stroke({ width: selected ? 2.5 : 1.5, color: selected ? 0xffffff : 0xfde68a, alpha: 1, join: "round" });
}

/** Translucent colony ship en route (distinct from military chevron). */
function drawColonyShipGhost(
  graphics: Graphics,
  fx: number,
  fy: number,
  dirx: number,
  diry: number,
  colorHex: string,
) {
  const fillColor = Number.parseInt(colorHex.replace("#", ""), 16);
  drawColonyTransportSilhouette(graphics, fx, fy, dirx, diry, fillColor, {
    selected: false,
    alpha: 0.4,
    strokeAlpha: 0.45,
    scale: 0.82,
  });
}

function drawColonyTransportSilhouette(
  graphics: Graphics,
  fx: number,
  fy: number,
  ox: number,
  oy: number,
  fillColor: number,
  sel: { selected: boolean; alpha: number; strokeAlpha: number; scale?: number },
) {
  const px = -oy;
  const py = ox;
  const sc = sel.scale ?? 1;
  const L = 14 * sc;
  const W = 5.4 * sc;
  const cx = fx + ox * (3.2 * sc);
  const cy = fy + oy * (3.2 * sc);
  const hull = [
    cx + ox * (L * 0.58),
    cy + oy * (L * 0.58),
    cx + px * W,
    cy + py * W,
    cx - ox * (L * 0.42),
    cy - oy * (L * 0.42),
    cx - px * W,
    cy - py * W,
  ];
  graphics.poly(hull).fill({ color: fillColor, alpha: sel.alpha });
  const domeX = cx + ox * (L * 0.12);
  const domeY = cy + oy * (L * 0.12);
  graphics.circle(domeX, domeY, 3.4 * sc).fill({ color: 0xcffafe, alpha: sel.alpha * 0.95 });
  const engLx = cx - px * (W * 0.32) - ox * (L * 0.44);
  const engLy = cy - py * (W * 0.32) - oy * (L * 0.44);
  const engRx = cx + px * (W * 0.32) - ox * (L * 0.44);
  const engRy = cy + py * (W * 0.32) - oy * (L * 0.44);
  graphics.circle(engLx, engLy, 2.2 * sc).fill({ color: 0x38bdf8, alpha: sel.alpha * 0.75 });
  graphics.circle(engRx, engRy, 2.2 * sc).fill({ color: 0x38bdf8, alpha: sel.alpha * 0.75 });
  if (sel.selected) {
    graphics.poly(hull).stroke({
      width: 2.4,
      color: 0xffffff,
      alpha: sel.strokeAlpha,
      join: "round",
    });
  } else {
    graphics.poly(hull).stroke({
      width: 1.2,
      color: 0xe2e8f0,
      alpha: sel.strokeAlpha * 0.55,
      join: "round",
    });
  }
}

/** Translucent detachment traveling along the hyperspace chord (star center to star center). */
function drawFleetShipGhost(
  graphics: Graphics,
  fx: number,
  fy: number,
  dirx: number,
  diry: number,
  colorHex: string,
  shipCount: number,
) {
  const ox = dirx;
  const oy = diry;
  const px = -oy;
  const py = ox;
  const wing = 6;
  const nose = 9;
  const scale = Math.min(1.35, 0.65 + Math.min(shipCount, 80) / 120);
  const w = wing * scale;
  const n = nose * scale;
  const xTip = fx + ox * n;
  const yTip = fy + oy * n;
  const xLeft = fx + px * w - ox * w * 0.35;
  const yLeft = fy + py * w - oy * w * 0.35;
  const xRight = fx - px * w - ox * w * 0.35;
  const yRight = fy - py * w - oy * w * 0.35;
  const fillColor = Number.parseInt(colorHex.replace("#", ""), 16);
  graphics
    .poly([xTip, yTip, xLeft, yLeft, xRight, yRight])
    .fill({ color: fillColor, alpha: 0.42 });
  graphics
    .poly([xTip, yTip, xLeft, yLeft, xRight, yRight])
    .stroke({ width: 1.5, color: 0xe2e8f0, alpha: 0.35, join: "round" });
}

function drawDashedPolyline(
  graphics: Graphics,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  opts: { width: number; color: number; alpha: number; dash: number; gap: number },
) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  if (len < 2) return;
  const ux = dx / len;
  const uy = dy / len;
  let pos = 0;
  let drawingDash = true;
  while (pos < len) {
    const segmentLength = drawingDash
      ? Math.min(opts.dash, len - pos)
      : Math.min(opts.gap, len - pos);
    if (drawingDash && segmentLength > 0.8) {
      const sx = x1 + ux * pos;
      const sy = y1 + uy * pos;
      const ex = x1 + ux * (pos + segmentLength);
      const ey = y1 + uy * (pos + segmentLength);
      graphics.moveTo(sx, sy).lineTo(ex, ey).stroke({
        width: opts.width,
        color: opts.color,
        alpha: opts.alpha,
        cap: "round",
      });
    }
    pos += segmentLength;
    drawingDash = !drawingDash;
  }
}

/** Dashed stroke along a circle (arc-length dash pattern, chord segments). */
function drawDashedCircle(
  graphics: Graphics,
  cx: number,
  cy: number,
  radius: number,
  opts: { width: number; color: number; alpha: number; dash: number; gap: number },
) {
  if (radius < 2) return;
  const circumference = 2 * Math.PI * radius;
  let pos = 0;
  let drawingDash = true;
  while (pos < circumference) {
    const segmentLength = drawingDash
      ? Math.min(opts.dash, circumference - pos)
      : Math.min(opts.gap, circumference - pos);
    if (drawingDash && segmentLength > 0.55) {
      const a0 = -Math.PI / 2 + pos / radius;
      const a1 = -Math.PI / 2 + (pos + segmentLength) / radius;
      const x0 = cx + Math.cos(a0) * radius;
      const y0 = cy + Math.sin(a0) * radius;
      const x1 = cx + Math.cos(a1) * radius;
      const y1 = cy + Math.sin(a1) * radius;
      graphics.moveTo(x0, y0).lineTo(x1, y1).stroke({
        width: opts.width,
        color: opts.color,
        alpha: opts.alpha,
        cap: "round",
      });
    }
    pos += segmentLength;
    drawingDash = !drawingDash;
  }
}
