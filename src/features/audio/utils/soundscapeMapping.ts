import type { GalaxyMapCamera } from "@/features/galaxy/utils/mapCamera";

export type SoundscapeActionType = "attack" | "defense" | "exploration";

export type SoundscapeEventRow = {
  _id: string;
  eventType: string;
  payload: string;
  turnNumber: number;
  actorType?: string | null;
  actorId?: string | null;
  targetId?: string | null;
};

export type SoundscapeCameraSnapshot = GalaxyMapCamera & {
  viewWidth: number;
  viewHeight: number;
};

export type SoundscapeSystemPosition = {
  x: number;
  y: number;
};

export type SoundscapeBellIntent = {
  eventId: string;
  actionType: SoundscapeActionType;
  sampleKey: SoundscapeActionType;
  systemId: string;
  ownerEmpireId: string | null;
  ownerVariant: number;
  noteOffsetSemitones: number;
  ownerDetuneCents: number;
  worldX: number;
  worldY: number;
  note: string;
  velocity: number;
  gain: number;
  pan: number;
  cutoffHz: number;
  releaseSeconds: number;
  reverbSend: number;
  fleetSize: number;
  importance: number;
  distanceRatio: number;
  turnNumber: number;
};

export type SoundscapeOwnershipContext = {
  fleetEmpireById?: Readonly<Record<string, string | null>>;
  colonyShipEmpireById?: Readonly<Record<string, string | null>>;
  systemOwnerById?: Readonly<Record<string, string | null>>;
};

const ATTACK_EVENT_TYPES = new Set([
  "battle_started",
  "battle_round_resolved",
  "battle_continues",
  "collateral_damage_applied",
  "system_claimed",
  "system_conquered",
]);

const DEFENSE_EVENT_TYPES = new Set([
  "battle_reinforced",
  "battle_defender_changed",
  "system_held",
]);

const EXPLORATION_EVENT_TYPES = new Set([
  "fleet_dispatched",
  "fleet_arrived",
  "colony_ship_dispatched",
  "colony_ship_arrived",
  "system_colonized",
]);

const NOTE_PALETTES: Record<SoundscapeActionType, readonly string[]> = {
  attack: ["C3", "Eb3", "G3", "Bb3", "C4"],
  defense: ["G2", "Bb2", "D3", "F3", "G3"],
  exploration: ["D4", "E4", "G4", "A4", "D5"],
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function lerp(from: number, to: number, amount: number): number {
  return from + (to - from) * amount;
}

function parsePayload(payload: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(payload);
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function numberField(record: Record<string, unknown> | null, key: string): number | null {
  if (record === null) {
    return null;
  }
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringField(record: Record<string, unknown> | null, key: string): string | null {
  if (record === null) {
    return null;
  }
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function stringArrayField(record: Record<string, unknown> | null, key: string): string[] {
  if (record === null) {
    return [];
  }
  const value = record[key];
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((entry): entry is string => typeof entry === "string" && entry.length > 0);
}

function stableHash(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function deriveEmpireBellProfile(empireId: string | null): {
  ownerVariant: number;
  noteOffsetSemitones: number;
  ownerDetuneCents: number;
} {
  if (empireId === null) {
    return {
      ownerVariant: 0,
      noteOffsetSemitones: 0,
      ownerDetuneCents: 0,
    };
  }

  const hash = stableHash(empireId);
  const noteOffsets = [-2, -1, 1, 2] as const;
  const detuneSteps = [-9, -4, 4, 9] as const;
  return {
    ownerVariant: hash % 4,
    noteOffsetSemitones: noteOffsets[(hash >>> 3) % noteOffsets.length] ?? 0,
    ownerDetuneCents: detuneSteps[(hash >>> 7) % detuneSteps.length] ?? 0,
  };
}

export function classifySoundscapeActionType(eventType: string): SoundscapeActionType | null {
  if (ATTACK_EVENT_TYPES.has(eventType)) {
    return "attack";
  }
  if (DEFENSE_EVENT_TYPES.has(eventType)) {
    return "defense";
  }
  if (EXPLORATION_EVENT_TYPES.has(eventType)) {
    return "exploration";
  }
  return null;
}

export function inferFleetSize(payload: Record<string, unknown> | null): number {
  const directFields = [
    "attackerShips",
    "defenderShips",
    "reinforcementShips",
    "ships",
  ] as const;
  for (const field of directFields) {
    const value = numberField(payload, field);
    if (value !== null) {
      return Math.max(1, Math.floor(value));
    }
  }

  const beforeA = numberField(payload, "attackerShipsBefore") ?? 0;
  const beforeD = numberField(payload, "defenderShipsBefore") ?? 0;
  const cargoUnits = numberField(payload, "cargoUnits") ?? 0;
  return Math.max(1, Math.floor(beforeA + beforeD), Math.floor(cargoUnits / 100));
}

export function inferImportance(
  actionType: SoundscapeActionType,
  fleetSize: number,
  payload: Record<string, unknown> | null,
): number {
  const base = clamp(Math.log10(Math.max(1, fleetSize) + 1) / 3, 0.12, 1);
  const motherships =
    (numberField(payload, "attackerMotherships") ?? 0) +
    (numberField(payload, "defenderMotherships") ?? 0);
  const collateral = numberField(payload, "damageAmount") ?? 0;
  const bonus = clamp(motherships * 0.15 + collateral / 250, 0, 0.4);
  const actionBias = actionType === "attack" ? 0.1 : actionType === "defense" ? 0.04 : 0;
  return clamp(base + bonus + actionBias, 0.12, 1);
}

export function computeListeningRadius(camera: SoundscapeCameraSnapshot): number {
  const shortestSide = Math.max(120, Math.min(camera.viewWidth, camera.viewHeight));
  return (shortestSide / camera.scale) * 0.72;
}

export function computeSpatialMix(
  worldX: number,
  worldY: number,
  camera: SoundscapeCameraSnapshot,
): Pick<
  SoundscapeBellIntent,
  "pan" | "gain" | "cutoffHz" | "reverbSend" | "distanceRatio"
> {
  const dx = worldX - camera.focusX;
  const dy = worldY - camera.focusY;
  const listeningRadius = computeListeningRadius(camera);
  const distanceRatio = clamp(Math.hypot(dx, dy) / listeningRadius, 0, 1.6);
  const halfVisibleWorldWidth = Math.max(camera.viewWidth / camera.scale / 2, 1);
  const pan = clamp(dx / halfVisibleWorldWidth, -1, 1);
  const nearFactor = 1 - clamp(distanceRatio, 0, 1);

  return {
    pan,
    gain: lerp(0.18, 1, nearFactor),
    cutoffHz: lerp(1200, 6200, nearFactor),
    reverbSend: lerp(0.38, 0.12, nearFactor),
    distanceRatio,
  };
}

export function selectBellNote(
  actionType: SoundscapeActionType,
  fleetSize: number,
): string {
  const palette = NOTE_PALETTES[actionType];
  const normalizedSize = clamp(Math.log2(Math.max(1, fleetSize) + 1) / 8, 0, 1);
  const descendingIndex = Math.round((1 - normalizedSize) * (palette.length - 1));
  return palette[descendingIndex] ?? palette[0];
}

export function resolveEventSystemId(
  event: SoundscapeEventRow,
  payload: Record<string, unknown> | null,
): string | null {
  return (
    stringField(payload, "systemId") ??
    stringField(payload, "originSystemId") ??
    stringField(payload, "destinationSystemId") ??
    event.targetId ??
    event.actorId ??
    null
  );
}

export function resolveEventEmpireId(params: {
  event: SoundscapeEventRow;
  actionType: SoundscapeActionType;
  payload: Record<string, unknown> | null;
  ownership?: SoundscapeOwnershipContext;
}): string | null {
  const { event, actionType, payload, ownership } = params;
  const actorEmpireId =
    event.actorType === "empire" && event.actorId !== undefined && event.actorId !== null
      ? event.actorId
      : null;
  const fleetEmpireId =
    event.actorId !== undefined && event.actorId !== null
      ? ownership?.fleetEmpireById?.[event.actorId] ?? null
      : null;
  const colonyShipEmpireId =
    event.actorId !== undefined && event.actorId !== null
      ? ownership?.colonyShipEmpireById?.[event.actorId] ?? null
      : null;
  const systemId = resolveEventSystemId(event, payload);
  const systemOwnerId = systemId !== null ? ownership?.systemOwnerById?.[systemId] ?? null : null;
  const attackerEmpireIds = stringArrayField(payload, "attackerEmpireIds");

  if (actionType === "attack") {
    return (
      stringField(payload, "attackerEmpireId") ??
      attackerEmpireIds[0] ??
      stringField(payload, "winnerEmpireId") ??
      actorEmpireId ??
      stringField(payload, "empireId") ??
      fleetEmpireId ??
      colonyShipEmpireId ??
      systemOwnerId
    );
  }

  if (actionType === "defense") {
    return (
      stringField(payload, "defenderEmpireId") ??
      stringField(payload, "winnerEmpireId") ??
      actorEmpireId ??
      stringField(payload, "empireId") ??
      fleetEmpireId ??
      colonyShipEmpireId ??
      systemOwnerId
    );
  }

  return (
    stringField(payload, "empireId") ??
    actorEmpireId ??
    fleetEmpireId ??
    colonyShipEmpireId ??
    stringField(payload, "winnerEmpireId") ??
    stringField(payload, "attackerEmpireId") ??
    stringField(payload, "defenderEmpireId") ??
    systemOwnerId
  );
}

export function toSoundscapeBellIntent(params: {
  event: SoundscapeEventRow;
  camera: SoundscapeCameraSnapshot;
  systemsById: Readonly<Record<string, SoundscapeSystemPosition>>;
  ownership?: SoundscapeOwnershipContext;
}): SoundscapeBellIntent | null {
  const actionType = classifySoundscapeActionType(params.event.eventType);
  if (actionType === null) {
    return null;
  }

  const payload = parsePayload(params.event.payload);
  const systemId = resolveEventSystemId(params.event, payload);
  if (systemId === null) {
    return null;
  }

  const system = params.systemsById[systemId];
  if (system === undefined) {
    return null;
  }

  const fleetSize = inferFleetSize(payload);
  const importance = inferImportance(actionType, fleetSize, payload);
  const spatial = computeSpatialMix(system.x, system.y, params.camera);
  const ownerEmpireId = resolveEventEmpireId({
    event: params.event,
    actionType,
    payload,
    ownership: params.ownership,
  });
  const ownerProfile = deriveEmpireBellProfile(ownerEmpireId);

  return {
    eventId: params.event._id,
    actionType,
    sampleKey: actionType,
    systemId,
    ownerEmpireId,
    ownerVariant: ownerProfile.ownerVariant,
    noteOffsetSemitones: ownerProfile.noteOffsetSemitones,
    ownerDetuneCents: ownerProfile.ownerDetuneCents,
    worldX: system.x,
    worldY: system.y,
    note: selectBellNote(actionType, fleetSize),
    velocity: clamp(0.38 + importance * 0.5, 0.2, 0.96),
    gain: clamp(spatial.gain * (0.82 + importance * 0.3), 0.08, 1),
    pan: spatial.pan,
    cutoffHz: spatial.cutoffHz,
    releaseSeconds:
      actionType === "attack"
        ? lerp(0.7, 1.4, importance)
        : actionType === "defense"
          ? lerp(1.2, 2.2, importance)
          : lerp(0.9, 1.6, importance),
    reverbSend: spatial.reverbSend,
    fleetSize,
    importance,
    distanceRatio: spatial.distanceRatio,
    turnNumber: params.event.turnNumber,
  };
}