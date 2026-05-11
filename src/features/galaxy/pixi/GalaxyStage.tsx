import { Application, extend, useApplication, useTick } from "@pixi/react";
import type { FederatedPointerEvent } from "pixi.js";
import { Circle, Container, Graphics, Point } from "pixi.js";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  FLEET_ORBIT_RADIUS,
  MAP_PAN_DRAG_THRESHOLD_PX,
  MAP_WHEEL_ZOOM_SENSITIVITY,
  STAR_HIT_RADIUS,
  TRAVEL_ANIM_MS,
} from "@/features/galaxy/constants";
import {
  clampMapScale,
  type GalaxyMapCamera,
  screenToWorld,
  zoomCameraTowardScreenPoint,
} from "@/features/galaxy/utils/mapCamera";
import {
  type GalaxyLinkRow,
  systemsShareLink,
} from "@/features/galaxy/utils/linkAdjacency";

extend({ Graphics, Container });

/** Fraction 0–1 along the origin→destination chord for in-flight ships (fleets, traders). */
export function enRouteLineFraction(params: {
  now: number;
  currentTurn: number;
  dispatchedTurn: number;
  travelTurnsTotal: number;
  turnStartedAt: number | null;
  travelAnimMs: number;
}): number {
  const {
    now,
    currentTurn,
    dispatchedTurn,
    travelTurnsTotal,
    turnStartedAt,
    travelAnimMs,
  } = params;
  const completedSegments = Math.min(
    Math.max(currentTurn - dispatchedTurn - 1, 0),
    travelTurnsTotal - 1,
  );
  const phase =
    turnStartedAt === null ? 0 : Math.min((now - turnStartedAt) / travelAnimMs, 1);
  return Math.min((completedSegments + phase) / travelTurnsTotal, 1);
}

export type GalaxyNode = {
  id: string;
  x: number;
  y: number;
  ownerColor: string;
};

/** Food shortage alert: severity 0–1 drives pulse speed (1 = critical, <1 turn of food). */
export type FoodAlertNode = { id: string; severity: number };
/** Starvation: population actively dying this turn (stockFood ≈ 0). */
export type StarvationNode = { id: string };

export type GalaxyLink = {
  fromId: string;
  toId: string;
};

export type FleetMarkerModel = {
  fleetId: string;
  originSystemId: string;
  x: number;
  y: number;
  colorHex: string;
};

export type PendingSegmentModel = {
  key: string;
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
  pendingSegments: PendingSegmentModel[];
  routeSegments: RouteSegmentModel[];
  enRouteGhosts: EnRouteGhostModel[];
  /** NPC / player traders in flight (cargo haulers). */
  traderShips: TraderShipModel[];
  turnTimeline: TurnTimelineModel | null;
  selectedFleetId: string | null;
  onSelectedFleetChange: (fleetId: string | null) => void;
  selectedTraderId: string | null;
  onSelectedTraderChange: (traderId: string | null) => void;
  shipsToDispatch: number;
  /** When true, a successful drag-drop also establishes a recurring route (viewport handles save). */
  repeatNextDragEnabled: boolean;
  canIssueOrders: boolean;
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
  pendingSegments,
  routeSegments,
  enRouteGhosts,
  traderShips,
  turnTimeline,
  selectedFleetId,
  onSelectedFleetChange,
  selectedTraderId,
  onSelectedTraderChange,
  shipsToDispatch,
  repeatNextDragEnabled,
  canIssueOrders,
  onFleetMoveCommit,
  onRouteMidpointTap,
  onStarPointerTap,
  onStarDoubleTap,
  onStageBackgroundTap,
  foodAlerts,
  starvationAlerts,
}: GalaxyStageProps) {
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
    "nodes" | "galaxyLinks" | "fleetMarkers" | "repeatNextDragEnabled" | "onFleetMoveCommit"
  >;
  const propsRef = useRef<DragResolveSnapshot>({
    nodes: [],
    galaxyLinks: [],
    fleetMarkers: [],
    repeatNextDragEnabled: false,
    onFleetMoveCommit: undefined,
  });
  useEffect(() => {
    propsRef.current = {
      nodes,
      galaxyLinks,
      fleetMarkers,
      repeatNextDragEnabled,
      onFleetMoveCommit,
    };
  }, [nodes, galaxyLinks, fleetMarkers, repeatNextDragEnabled, onFleetMoveCommit]);

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
      panCleanupRef.current?.();
      panCleanupRef.current = null;
    };
  }, []);

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
        repeatNextDragEnabled: recurring,
        onFleetMoveCommit: commit,
      } = propsRef.current;
      const { x, y } = clientToWorld(ev.clientX, ev.clientY);
      const dropSystemId = hitTestSystem(nd, x, y);
      const fleet = fm.find((marker) => marker.fleetId === dragFleetId);
      const shipCount = dragShipCountRef.current;

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

  const handleFleetPointerDown = useCallback(
    (fleet: FleetMarkerModel, event: FederatedPointerEvent) => {
      if (!canIssueOrders) return;
      event.stopPropagation();
      onSelectedFleetChange(fleet.fleetId);
      const n = Math.max(0, Math.floor(shipsToDispatch));
      dragShipCountRef.current = n;
      if (n < 1) {
        return;
      }
      setDragFleetId(fleet.fleetId);
      const cam = cameraRef.current;
      const w = screenToWorld(event.global.x, event.global.y, cam, viewW, viewH);
      setDragCursorPos({ x: w.x, y: w.y });
    },
    [viewW, viewH, canIssueOrders, onSelectedFleetChange, shipsToDispatch],
  );

  const dragPreviewFleet =
    dragFleetId === null ? null : fleetMarkers.find((m) => m.fleetId === dragFleetId);

  const readyCursor = canIssueOrders && shipsToDispatch >= 1;

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
          draw={(graphics) => drawHyperlanes(graphics, nodes, links)}
        />
        <pixiGraphics
          eventMode="none"
          draw={(graphics) => drawRouteSegments(graphics, routeSegments)}
        />
        <pixiGraphics
          eventMode="none"
          draw={(graphics) => drawPendingSegments(graphics, pendingSegments)}
        />
        {nodes.map((node) => (
          <pixiGraphics
            key={node.id}
            eventMode="static"
            cursor={
              onStarPointerTap !== undefined || onStarDoubleTap !== undefined
                ? "pointer"
                : "default"
            }
            onPointerTap={(event: FederatedPointerEvent) => {
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
            }}
            draw={(graphics) => drawStar(graphics, node)}
          />
        ))}
        <StarAlertGraphics
          foodAlerts={foodAlerts}
          starvationAlerts={starvationAlerts}
          nodes={nodes}
        />
        <EnRouteGhostGraphics
          ghosts={enRouteGhosts}
          nodes={nodes}
          turnTimeline={turnTimeline}
        />
        {traderShips.map((trader) => (
          <TraderShipMarker
            key={trader.traderId}
            trader={trader}
            nodes={nodes}
            turnTimeline={turnTimeline}
            selected={selectedTraderId === trader.traderId}
            onTap={() => {
              onSelectedTraderChange(trader.traderId);
            }}
          />
        ))}
        {fleetMarkers.map((fleet) => (
          <pixiGraphics
            key={fleet.fleetId}
            eventMode={canIssueOrders ? "static" : "auto"}
            cursor={readyCursor ? "grab" : canIssueOrders ? "pointer" : "default"}
            onPointerDown={(event: FederatedPointerEvent) =>
              handleFleetPointerDown(fleet, event)
            }
            draw={(graphics) =>
              drawFleetShip(
                graphics,
                fleet,
                nodes.find((node) => node.id === fleet.originSystemId),
                selectedFleetId === fleet.fleetId,
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
              }}
            />
          )}
        {routeSegments.map((seg) => {
          const mx = (seg.x1 + seg.x2) / 2;
          const my = (seg.y1 + seg.y2) / 2;
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
                graphics
                  .circle(mx, my, 5)
                  .stroke({ width: 2, color: seg.enabled ? 0xc084fc : 0x64748b, alpha: 0.9 });
              }}
            />
          );
        })}
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

      for (const ghost of ghosts) {
        const from = nodes.find((n) => n.id === ghost.originSystemId);
        const to = nodes.find((n) => n.id === ghost.destSystemId);
        if (!from || !to) continue;

        const t = Math.max(1, ghost.travelTurnsTotal);
        const fraction = enRouteLineFraction({
          now,
          currentTurn,
          dispatchedTurn: ghost.dispatchedTurn,
          travelTurnsTotal: t,
          turnStartedAt,
          travelAnimMs: TRAVEL_ANIM_MS,
        });

        const gx = from.x + (to.x - from.x) * fraction;
        const gy = from.y + (to.y - from.y) * fraction;
        const ox = to.x - from.x;
        const oy = to.y - from.y;
        const len = Math.hypot(ox, oy) || 1;
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

      const from = nodes.find((n) => n.id === trader.originSystemId);
      const to = nodes.find((n) => n.id === trader.destSystemId);
      if (!from || !to) return;

      const t = Math.max(1, trader.travelTurnsTotal);
      const fraction = enRouteLineFraction({
        now,
        currentTurn,
        dispatchedTurn: trader.dispatchedTurn,
        travelTurnsTotal: t,
        turnStartedAt,
        travelAnimMs: TRAVEL_ANIM_MS,
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

function drawRouteSegments(graphics: Graphics, segments: RouteSegmentModel[]) {
  graphics.clear();
  for (const segment of segments) {
    drawDashedPolyline(
      graphics,
      segment.x1,
      segment.y1,
      segment.x2,
      segment.y2,
      {
        width: 2,
        color: segment.enabled ? 0xc084fc : 0x64748b,
        alpha: segment.enabled ? 0.88 : 0.45,
        dash: 11,
        gap: 9,
      },
    );
  }
}

function drawPendingSegments(graphics: Graphics, segments: PendingSegmentModel[]) {
  graphics.clear();
  for (const segment of segments) {
    drawDashedPolyline(
      graphics,
      segment.x1,
      segment.y1,
      segment.x2,
      segment.y2,
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
