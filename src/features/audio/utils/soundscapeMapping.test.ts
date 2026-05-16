import { describe, expect, test } from "vitest";
import {
  classifySoundscapeActionType,
  computeListeningRadius,
  computeSpatialMix,
  deriveEmpireBellProfile,
  selectBellNote,
  toSoundscapeBellIntent,
  type SoundscapeCameraSnapshot,
  type SoundscapeEventRow,
} from "./soundscapeMapping";

const camera: SoundscapeCameraSnapshot = {
  focusX: 100,
  focusY: 100,
  scale: 1,
  viewWidth: 800,
  viewHeight: 600,
};

describe("soundscapeMapping", () => {
  test("classifies supported event types into gameplay audio buckets", () => {
    expect(classifySoundscapeActionType("battle_started")).toBe("attack");
    expect(classifySoundscapeActionType("system_held")).toBe("defense");
    expect(classifySoundscapeActionType("fleet_dispatched")).toBe("exploration");
    expect(classifySoundscapeActionType("turn_resolved")).toBeNull();
  });

  test("maps larger fleets to lower notes within each palette", () => {
    expect(selectBellNote("attack", 3)).toBe("Bb3");
    expect(selectBellNote("attack", 200)).toBe("C3");
    expect(selectBellNote("exploration", 2)).toBe("A4");
  });

  test("narrows listening radius as the camera zooms in", () => {
    expect(computeListeningRadius(camera)).toBeCloseTo(432);
    expect(computeListeningRadius({ ...camera, scale: 2 })).toBeCloseTo(216);
  });

  test("pushes distant events to the side and muffles them", () => {
    const near = computeSpatialMix(130, 120, camera);
    const farRight = computeSpatialMix(650, 100, camera);

    expect(near.gain).toBeGreaterThan(farRight.gain);
    expect(near.cutoffHz).toBeGreaterThan(farRight.cutoffHz);
    expect(farRight.pan).toBe(1);
  });

  test("builds a bell intent from a combat event and known system position", () => {
    const event: SoundscapeEventRow = {
      _id: "evt-1",
      eventType: "battle_started",
      payload: JSON.stringify({
        systemId: "sys-a",
        attackerEmpireId: "emp-aurora",
        attackerShips: 24,
        defenderShips: 10,
      }),
      turnNumber: 8,
      actorType: "empire",
      actorId: "emp-aurora",
    };

    const intent = toSoundscapeBellIntent({
      event,
      camera,
      systemsById: {
        "sys-a": { x: 140, y: 90 },
      },
    });

    expect(intent).not.toBeNull();
    expect(intent?.actionType).toBe("attack");
    expect(intent?.systemId).toBe("sys-a");
    expect(intent?.ownerEmpireId).toBe("emp-aurora");
    expect(intent?.fleetSize).toBe(24);
    expect(intent?.note).toBe("G3");
    expect(intent?.gain).toBeGreaterThan(0.5);
    expect(intent?.pan).toBeGreaterThan(0);
  });

  test("derives a deterministic ownership profile for bell identity", () => {
    const aurora = deriveEmpireBellProfile("emp-aurora");
    const nebula = deriveEmpireBellProfile("emp-nebula");

    expect(aurora).toEqual(deriveEmpireBellProfile("emp-aurora"));
    expect(aurora.ownerVariant).toBeGreaterThanOrEqual(0);
    expect(aurora.ownerVariant).toBeLessThan(4);
    expect([-2, -1, 1, 2]).toContain(aurora.noteOffsetSemitones);
    expect([-9, -4, 4, 9]).toContain(aurora.ownerDetuneCents);
    expect(nebula).not.toEqual(aurora);
  });

  test("falls back to entity ownership maps when movement events lack empire ids", () => {
    const event: SoundscapeEventRow = {
      _id: "evt-3",
      eventType: "fleet_arrived",
      payload: JSON.stringify({ systemId: "sys-b", fleetId: "fleet-1" }),
      turnNumber: 9,
      actorType: "fleet",
      actorId: "fleet-1",
    };

    const intent = toSoundscapeBellIntent({
      event,
      camera,
      systemsById: {
        "sys-b": { x: 80, y: 120 },
      },
      ownership: {
        fleetEmpireById: { "fleet-1": "emp-scout" },
      },
    });

    expect(intent?.actionType).toBe("exploration");
    expect(intent?.ownerEmpireId).toBe("emp-scout");
  });

  test("drops events that cannot be located on the map", () => {
    const event: SoundscapeEventRow = {
      _id: "evt-2",
      eventType: "system_colonized",
      payload: JSON.stringify({ systemId: "missing" }),
      turnNumber: 3,
    };

    expect(
      toSoundscapeBellIntent({
        event,
        camera,
        systemsById: {},
      }),
    ).toBeNull();
  });
});