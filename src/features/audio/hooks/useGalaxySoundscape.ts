import { useCallback, useEffect, useRef, useState } from "react";
import {
  createGalaxySoundscapeEngine,
  ensureToneReady,
  type GalaxySoundscapeEngine,
} from "@/features/audio/lib/galaxySoundscapeEngine";
import {
  toSoundscapeBellIntent,
  type SoundscapeCameraSnapshot,
  type SoundscapeEventRow,
  type SoundscapeOwnershipContext,
  type SoundscapeSystemPosition,
} from "@/features/audio/utils/soundscapeMapping";
import {
  buildSoundscapePlaybackPlan,
  type SoundscapeTimelineSnapshot,
} from "@/features/audio/utils/soundscapeTimeline";

export type SoundscapeStatus = "off" | "starting" | "ready" | "error";

const SOUND_ENABLED_STORAGE_KEY = "starstrat:galaxySoundscapeEnabled";

function readStoredEnabled(): boolean {
  try {
    return localStorage.getItem(SOUND_ENABLED_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function writeStoredEnabled(enabled: boolean): void {
  try {
    if (enabled) {
      localStorage.setItem(SOUND_ENABLED_STORAGE_KEY, "1");
    } else {
      localStorage.removeItem(SOUND_ENABLED_STORAGE_KEY);
    }
  } catch {
    /* ignore */
  }
}

function errorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  return raw.replace(/^[\s\S]*?Error:\s*/g, "").trim() || "Unable to start soundscape.";
}

export function useGalaxySoundscape(params: {
  activeGameId: string | null;
  camera: SoundscapeCameraSnapshot;
  recentEvents: SoundscapeEventRow[];
  systemsById: Readonly<Record<string, SoundscapeSystemPosition>>;
  ownership?: SoundscapeOwnershipContext;
  listenerEmpireId?: string | null;
  timeline?: SoundscapeTimelineSnapshot | null;
}) {
  const { activeGameId, camera, recentEvents, systemsById, ownership, listenerEmpireId, timeline } = params;
  const [enabled, setEnabled] = useState<boolean>(() => readStoredEnabled());
  const [status, setStatus] = useState<SoundscapeStatus>(enabled ? "starting" : "off");
  const [error, setError] = useState<string | null>(null);
  const engineRef = useRef<GalaxySoundscapeEngine | null>(null);
  const seenEventIdsRef = useRef<Set<string>>(new Set());
  const pendingPlaybackTimersRef = useRef<Map<string, number>>(new Map());
  const activeGameIdRef = useRef<string | null>(activeGameId);

  const clearPendingPlaybackTimers = useCallback(() => {
    for (const timer of pendingPlaybackTimersRef.current.values()) {
      window.clearTimeout(timer);
    }
    pendingPlaybackTimersRef.current.clear();
  }, []);

  const disableSoundscape = useCallback(() => {
    clearPendingPlaybackTimers();
    engineRef.current?.dispose();
    engineRef.current = null;
    seenEventIdsRef.current = new Set();
    activeGameIdRef.current = activeGameId;
    setEnabled(false);
    setStatus("off");
    setError(null);
    writeStoredEnabled(false);
  }, [activeGameId, clearPendingPlaybackTimers]);

  const enableSoundscape = useCallback(async () => {
    if (engineRef.current !== null) {
      setEnabled(true);
      setStatus("ready");
      setError(null);
      writeStoredEnabled(true);
      return;
    }

    setStatus("starting");
    setError(null);
    try {
      await ensureToneReady();
      const engine = await createGalaxySoundscapeEngine({
        turnDurationMs: timeline?.turnDurationMs ?? null,
      });
      engineRef.current = engine;
      activeGameIdRef.current = activeGameId;
      seenEventIdsRef.current = new Set(recentEvents.map((event) => String(event._id)));
      setEnabled(true);
      setStatus("ready");
      writeStoredEnabled(true);
    } catch (soundError) {
      setEnabled(false);
      setStatus("error");
      setError(errorMessage(soundError));
      writeStoredEnabled(false);
    }
  }, [activeGameId, recentEvents, timeline?.turnDurationMs]);

  useEffect(() => {
    return () => {
      clearPendingPlaybackTimers();
      engineRef.current?.dispose();
      engineRef.current = null;
    };
  }, [clearPendingPlaybackTimers]);

  useEffect(() => {
    if (!enabled) {
      return;
    }
    if (engineRef.current !== null) {
      return;
    }
    void enableSoundscape();
  }, [enabled, enableSoundscape]);

  useEffect(() => {
    if (engineRef.current === null) {
      activeGameIdRef.current = activeGameId;
      return;
    }
    if (activeGameIdRef.current === activeGameId) {
      return;
    }
    activeGameIdRef.current = activeGameId;
    clearPendingPlaybackTimers();
    seenEventIdsRef.current = new Set(recentEvents.map((event) => String(event._id)));
  }, [activeGameId, recentEvents, clearPendingPlaybackTimers]);

  useEffect(() => {
    const engine = engineRef.current;
    if (!enabled || engine === null) {
      return;
    }
    const seen = seenEventIdsRef.current;
    const unseenEvents = [...recentEvents].reverse().filter((event) => !seen.has(String(event._id)));
    const playbackPlan = new Map(
      buildSoundscapePlaybackPlan({
        events: unseenEvents.map((event) => ({ _id: String(event._id), turnNumber: event.turnNumber })),
        timeline: timeline ?? null,
      }).map((row) => [row.eventId, row]),
    );

    for (const event of unseenEvents) {
      const eventId = String(event._id);
      seen.add(eventId);
      const intent = toSoundscapeBellIntent({
        event: {
          _id: eventId,
          eventType: event.eventType,
          payload: event.payload,
          turnNumber: event.turnNumber,
          actorType: event.actorType,
          actorId: event.actorId,
          targetId: event.targetId,
        },
        camera,
        systemsById,
        ownership,
        listenerEmpireId,
      });
      if (intent !== null) {
        const delayMs = playbackPlan.get(eventId)?.delayMs ?? 0;
        if (delayMs <= 16) {
          engine.playBell(intent);
          continue;
        }
        const timer = window.setTimeout(() => {
          pendingPlaybackTimersRef.current.delete(eventId);
          engineRef.current?.playBell(intent);
        }, delayMs);
        pendingPlaybackTimersRef.current.set(eventId, timer);
      }
    }
  }, [enabled, camera, recentEvents, systemsById, ownership, listenerEmpireId, timeline]);

  return {
    soundscapeEnabled: enabled && status === "ready",
    soundscapeStatus: status,
    soundscapeError: error,
    enableSoundscape,
    disableSoundscape,
  };
}