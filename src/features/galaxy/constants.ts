export const GALAXY_STAGE_WIDTH = 760;
export const GALAXY_STAGE_HEIGHT = 520;
/** Idle fleets orbit outside the white system ring (~radius 19 + stroke). */
export const FLEET_ORBIT_RADIUS = 28;
/** Star tap target slightly larger than the drawn disk for comfortable clicks. */
export const STAR_HIT_RADIUS = 24;
/** Client-side seconds per turn slice shown along a hyperspace hop (freeze after if the turn is longer). */
export const TRAVEL_ANIM_MS = 15_000;

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
