import { describe, expect, test } from "vitest";
import {
  computeFitGalaxyHorizontal,
  nextQuarterTurnClockwise,
  normalizeCameraRotation,
  screenToWorld,
  worldToScreen,
  zoomCameraTowardScreenPoint,
  type GalaxyMapCamera,
} from "./mapCamera";

const VIEW_WIDTH = 760;
const VIEW_HEIGHT = 520;

describe("mapCamera", () => {
  test("round-trips world and screen coordinates across quarter turns", () => {
    const camera: GalaxyMapCamera = {
      focusX: 120,
      focusY: -45,
      scale: 1.75,
      rotation: Math.PI / 2,
    };

    const world = { x: 310, y: 90 };
    const screen = worldToScreen(world.x, world.y, camera, VIEW_WIDTH, VIEW_HEIGHT);
    const roundTrip = screenToWorld(screen.x, screen.y, camera, VIEW_WIDTH, VIEW_HEIGHT);

    expect(roundTrip.x).toBeCloseTo(world.x, 6);
    expect(roundTrip.y).toBeCloseTo(world.y, 6);
  });

  test("keeps the anchored world point under the cursor while zooming with rotation", () => {
    const camera: GalaxyMapCamera = {
      focusX: 80,
      focusY: 160,
      scale: 0.8,
      rotation: Math.PI / 2,
    };

    const cursor = { x: 520, y: 180 };
    const anchoredWorld = screenToWorld(cursor.x, cursor.y, camera, VIEW_WIDTH, VIEW_HEIGHT);
    const next = zoomCameraTowardScreenPoint(
      camera,
      cursor.x,
      cursor.y,
      1.9,
      VIEW_WIDTH,
      VIEW_HEIGHT,
    );
    const anchoredScreen = worldToScreen(
      anchoredWorld.x,
      anchoredWorld.y,
      next,
      VIEW_WIDTH,
      VIEW_HEIGHT,
    );

    expect(anchoredScreen.x).toBeCloseTo(cursor.x, 6);
    expect(anchoredScreen.y).toBeCloseTo(cursor.y, 6);
  });

  test("normalizes negative rotations into the canonical full-turn range", () => {
    expect(normalizeCameraRotation(-Math.PI / 2)).toBeCloseTo((Math.PI * 3) / 2, 6);
  });

  test("advances an arbitrary angle to the next clockwise quarter turn", () => {
    expect(nextQuarterTurnClockwise(Math.PI / 7)).toBeCloseTo(Math.PI / 2, 6);
    expect(nextQuarterTurnClockwise(Math.PI / 2)).toBeCloseTo(Math.PI, 6);
    expect(nextQuarterTurnClockwise(Math.PI * 1.8)).toBeCloseTo(Math.PI * 2, 6);
  });

  test("fits a wide galaxy more tightly after a quarter turn", () => {
    const positions = [
      { x: 0, y: 0 },
      { x: 1000, y: 120 },
    ];

    const horizontal = computeFitGalaxyHorizontal(positions, VIEW_WIDTH, VIEW_HEIGHT, 0);
    const rotated = computeFitGalaxyHorizontal(
      positions,
      VIEW_WIDTH,
      VIEW_HEIGHT,
      Math.PI / 2,
    );

    expect(rotated.rotation).toBeCloseTo(Math.PI / 2, 6);
    expect(rotated.scale).toBeGreaterThan(horizontal.scale);
  });
});