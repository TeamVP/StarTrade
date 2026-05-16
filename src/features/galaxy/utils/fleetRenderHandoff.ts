export type FleetRenderGhostVariant = "fleet" | "colony";

export function resolveGhostRenderState(params: {
  variant: FleetRenderGhostVariant;
  progress: number;
  markerVisible: boolean;
}): {
  drawGhost: boolean;
  renderFraction: number;
} {
  if (params.variant === "colony") {
    return { drawGhost: true, renderFraction: params.progress };
  }

  if (params.progress >= 1) {
    if (params.markerVisible) {
      return { drawGhost: false, renderFraction: 1 };
    }
    return { drawGhost: true, renderFraction: 1 };
  }

  return { drawGhost: true, renderFraction: params.progress };
}

export function shouldFadeInFleetMarker(params: {
  ghostVisibleNow: boolean;
  ghostRecentlyVisible: boolean;
}): boolean {
  return !(params.ghostVisibleNow || params.ghostRecentlyVisible);
}