import { DEFAULT_TURN_DURATION_MS } from "../../../convex/sim/turnTiming";

export const GALAXY_STAGE_WIDTH = 760;
export const GALAXY_STAGE_HEIGHT = 520;
/** Idle fleets orbit outside the white system ring (~radius 19 + stroke). */
export const FLEET_ORBIT_RADIUS = 28;
/** Colony transports share fleet orbital distance; angle separates icons on the ring. */
export const COLONY_ORBIT_RADIUS = FLEET_ORBIT_RADIUS;
/** Offset on the orbit ring so colony ships sit ~45° from the fleet placement convention. */
export const COLONY_ORBIT_ANGLE_OFFSET_RAD = Math.PI / 4;
/** Star tap target slightly larger than the drawn disk for comfortable clicks. */
export const STAR_HIT_RADIUS = 24;
/** Fallback travel animation duration when the turn timeline is unavailable. */
export const TRAVEL_ANIM_MS = DEFAULT_TURN_DURATION_MS;

/** Map camera: min/max zoom scale (1 = default world units). */
export const MIN_MAP_SCALE = 0.35;
export const MAX_MAP_SCALE = 4;

/** Wheel zoom: sensitivity via `scale *= exp(-deltaY * factor)`. */
export const MAP_WHEEL_ZOOM_SENSITIVITY = 0.0012;

/**
 * Per-click pulse fractions toward the full target (centered on star, fully zoomed in).
 * Centering is aggressive so the picked star reaches the middle quickly; zoom is gentle
 * so the player keeps spatial context and uses multiple clicks to drill in.
 */
export const STAR_CLICK_RECENTER_FRACTION = 0.75;
export const STAR_CLICK_ZOOM_FRACTION = 0.25;

/** Extra pixels around fitted bounds when computing zoom caps / fit-all. */
export const MAP_ZOOM_MARGIN_PX = 48;

/** Background drag distance before counting as pan (tap below this dismisses panels). */
export const MAP_PAN_DRAG_THRESHOLD_PX = 6;

/** Buttons / keyboard-free zoom steps (+/- controls). */
export const MAP_BUTTON_ZOOM_FACTOR = 1.2;

/** Duration for ease-out camera glide when double-clicking a star (ms). */
export const MAP_CAMERA_TWEEN_MS = 480;
