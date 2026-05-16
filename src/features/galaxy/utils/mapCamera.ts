import type { GalaxyLinkRow } from "@/features/galaxy/utils/linkAdjacency";
import {
  GALAXY_STAGE_HEIGHT,
  GALAXY_STAGE_WIDTH,
  MAP_ZOOM_MARGIN_PX,
  MAX_MAP_SCALE,
  MIN_MAP_SCALE,
} from "@/features/galaxy/constants";

export type GalaxyMapCamera = {
  focusX: number;
  focusY: number;
  scale: number;
};

/** Ease-out cubic for camera tweens (slows into the target). */
export function easeOutCubic(t: number): number {
  const u = 1 - Math.min(1, Math.max(0, t));
  return 1 - u * u * u;
}

export function clampMapScale(scale: number): number {
  return Math.min(MAX_MAP_SCALE, Math.max(MIN_MAP_SCALE, scale));
}

/**
 * Stage pixel coords → world coords for pivot-centered camera.
 * Use {@link GALAXY_STAGE_WIDTH} / {@link GALAXY_STAGE_HEIGHT} only when they match `app.screen`;
 * pass `app.screen.width` / `app.screen.height` from the live Application so HiDPI/resolution matches Pixi.
 */
export function screenToWorld(
  screenX: number,
  screenY: number,
  camera: GalaxyMapCamera,
  viewWidth: number = GALAXY_STAGE_WIDTH,
  viewHeight: number = GALAXY_STAGE_HEIGHT,
): { x: number; y: number } {
  const cx = viewWidth / 2;
  const cy = viewHeight / 2;
  const s = camera.scale;
  return {
    x: camera.focusX + (screenX - cx) / s,
    y: camera.focusY + (screenY - cy) / s,
  };
}

export function worldToScreen(
  worldX: number,
  worldY: number,
  camera: GalaxyMapCamera,
  viewWidth: number = GALAXY_STAGE_WIDTH,
  viewHeight: number = GALAXY_STAGE_HEIGHT,
): { x: number; y: number } {
  const cx = viewWidth / 2;
  const cy = viewHeight / 2;
  const s = camera.scale;
  return {
    x: cx + (worldX - camera.focusX) * s,
    y: cy + (worldY - camera.focusY) * s,
  };
}

/** Zoom toward a fixed screen point; returns camera that keeps that world point under the cursor. */
export function zoomCameraTowardScreenPoint(
  camera: GalaxyMapCamera,
  screenX: number,
  screenY: number,
  newScale: number,
  viewWidth: number = GALAXY_STAGE_WIDTH,
  viewHeight: number = GALAXY_STAGE_HEIGHT,
): GalaxyMapCamera {
  const s0 = camera.scale;
  const s1 = clampMapScale(newScale);
  if (Math.abs(s1 - s0) < 1e-9) {
    return { ...camera, scale: s1 };
  }
  const { x: wx, y: wy } = screenToWorld(screenX, screenY, camera, viewWidth, viewHeight);
  const focusX = wx - ((wx - camera.focusX) * s0) / s1;
  const focusY = wy - ((wy - camera.focusY) * s0) / s1;
  return { focusX, focusY, scale: s1 };
}

export function computeFitAllSystemsCamera(
  positions: readonly { x: number; y: number }[],
  viewWidth: number = GALAXY_STAGE_WIDTH,
  viewHeight: number = GALAXY_STAGE_HEIGHT,
): GalaxyMapCamera {
  const pad = MAP_ZOOM_MARGIN_PX;
  const W = Math.max(viewWidth, 1);
  const H = Math.max(viewHeight, 1);
  if (positions.length === 0) {
    return { focusX: W / 2, focusY: H / 2, scale: 1 };
  }
  let minX = positions[0].x;
  let maxX = positions[0].x;
  let minY = positions[0].y;
  let maxY = positions[0].y;
  for (let i = 1; i < positions.length; i++) {
    const p = positions[i];
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }
  const bw = Math.max(maxX - minX, 80);
  const bh = Math.max(maxY - minY, 80);
  const usableW = Math.max(W - 2 * pad, 1);
  const usableH = Math.max(H - 2 * pad, 1);
  const scale = clampMapScale(Math.min(usableW / bw, usableH / bh));
  return {
    focusX: (minX + maxX) / 2,
    focusY: (minY + maxY) / 2,
    scale,
  };
}

/** Fit the galaxy to the full width of the viewport (scale driven by horizontal extent). */
export function computeFitGalaxyHorizontal(
  positions: readonly { x: number; y: number }[],
  viewWidth: number = GALAXY_STAGE_WIDTH,
  viewHeight: number = GALAXY_STAGE_HEIGHT,
): GalaxyMapCamera {
  const pad = MAP_ZOOM_MARGIN_PX;
  const W = Math.max(viewWidth, 1);
  const H = Math.max(viewHeight, 1);
  if (positions.length === 0) {
    return { focusX: W / 2, focusY: H / 2, scale: 1 };
  }
  let minX = positions[0].x;
  let maxX = positions[0].x;
  let minY = positions[0].y;
  let maxY = positions[0].y;
  for (let i = 1; i < positions.length; i++) {
    const p = positions[i];
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }
  const bw = Math.max(maxX - minX, 80);
  const usableW = Math.max(W - 2 * pad, 1);
  const scale = clampMapScale(usableW / bw);
  return {
    focusX: (minX + maxX) / 2,
    focusY: (minY + maxY) / 2,
    scale,
  };
}

/** Fit the galaxy to the full height of the viewport (scale driven by vertical extent). */
export function computeFitGalaxyVertical(
  positions: readonly { x: number; y: number }[],
  viewWidth: number = GALAXY_STAGE_WIDTH,
  viewHeight: number = GALAXY_STAGE_HEIGHT,
): GalaxyMapCamera {
  const pad = MAP_ZOOM_MARGIN_PX;
  const W = Math.max(viewWidth, 1);
  const H = Math.max(viewHeight, 1);
  if (positions.length === 0) {
    return { focusX: W / 2, focusY: H / 2, scale: 1 };
  }
  let minX = positions[0].x;
  let maxX = positions[0].x;
  let minY = positions[0].y;
  let maxY = positions[0].y;
  for (let i = 1; i < positions.length; i++) {
    const p = positions[i];
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }
  const bh = Math.max(maxY - minY, 80);
  const usableH = Math.max(H - 2 * pad, 1);
  const scale = clampMapScale(usableH / bh);
  return {
    focusX: (minX + maxX) / 2,
    focusY: (minY + maxY) / 2,
    scale,
  };
}

/** Max scale so selected star + up to `hopDepth` graph hops stay in view (radius from selected center). */
export function computeMaxScaleForNeighborhood(
  systemId: string,
  links: readonly GalaxyLinkRow[],
  positionsById: Readonly<Record<string, { x: number; y: number }>>,
  hopDepth: number,
  viewWidth: number = GALAXY_STAGE_WIDTH,
  viewHeight: number = GALAXY_STAGE_HEIGHT,
): number {
  const center = positionsById[systemId];
  if (center === undefined) {
    return MAX_MAP_SCALE;
  }

  const adj = new Map<string, Set<string>>();
  for (const row of links) {
    const a = row.fromSystemId;
    const b = row.toSystemId;
    if (!adj.has(a)) adj.set(a, new Set());
    if (!adj.has(b)) adj.set(b, new Set());
    adj.get(a)!.add(b);
    adj.get(b)!.add(a);
  }

  const visited = new Set<string>([systemId]);
  let frontier = new Set<string>([systemId]);
  for (let h = 0; h < hopDepth; h++) {
    const next = new Set<string>();
    for (const id of frontier) {
      const nbrs = adj.get(id);
      if (nbrs === undefined) continue;
      for (const n of nbrs) {
        if (!visited.has(n)) {
          visited.add(n);
          next.add(n);
        }
      }
    }
    frontier = next;
  }

  let radiusSq = 100;
  for (const id of visited) {
    const p = positionsById[id];
    if (p === undefined) continue;
    const dx = p.x - center.x;
    const dy = p.y - center.y;
    radiusSq = Math.max(radiusSq, dx * dx + dy * dy);
  }
  const radius = Math.sqrt(radiusSq);
  const usable = Math.min(viewWidth, viewHeight) / 2 - MAP_ZOOM_MARGIN_PX;
  if (usable <= 4) {
    return MIN_MAP_SCALE;
  }
  return clampMapScale(usable / Math.max(radius + MAP_ZOOM_MARGIN_PX * 0.5, 40));
}
