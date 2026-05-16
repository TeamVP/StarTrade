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
import { playUiSound } from "@/lib/audio/uiSounds";

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

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function useGalaxySoundscape(params: {
  activeGameId: string | null;
  canAutoStart: boolean;
  camera: SoundscapeCameraSnapshot;
  recentEvents: SoundscapeEventRow[];
  systemsById: Readonly<Record<string, SoundscapeSystemPosition>>;
  ownership?: SoundscapeOwnershipContext;
  listenerEmpireId?: string | null;
  timeline?: SoundscapeTimelineSnapshot | null;
}) {
  const {
    activeGameId,
    canAutoStart,
    camera,
    recentEvents,
    systemsById,
    ownership,
    listenerEmpireId,
    timeline,
  } = params;
  const [enabled, setEnabled] = useState<boolean>(() => readStoredEnabled());
  const [status, setStatus] = useState<SoundscapeStatus>("off");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const engineRef = useRef<GalaxySoundscapeEngine | null>(null);
  const seenEventIdsRef = useRef<Set<string>>(new Set());
  const pendingPlaybackTimersRef = useRef<Map<string, number>>(new Map());
  const noticeTimerRef = useRef<number | null>(null);
  const activeGameIdRef = useRef<string | null>(activeGameId);
  const startupPromiseRef = useRef<Promise<void> | null>(null);
  const startupTokenRef = useRef(0);
  const mountedRef = useRef(true);

  const clearPendingPlaybackTimers = useCallback(() => {
    for (const timer of pendingPlaybackTimersRef.current.values()) {
      window.clearTimeout(timer);
    }
    pendingPlaybackTimersRef.current.clear();
  }, []);

  const clearNoticeTimer = useCallback(() => {
    if (noticeTimerRef.current !== null) {
      window.clearTimeout(noticeTimerRef.current);
      noticeTimerRef.current = null;
    }
  }, []);

  const showNotice = useCallback((message: string, durationMs = 3600) => {
    clearNoticeTimer();
    setNotice(message);
    noticeTimerRef.current = window.setTimeout(() => {
      noticeTimerRef.current = null;
      setNotice(null);
    }, durationMs);
  }, [clearNoticeTimer]);

  const toBellIntent = useCallback(
    (event: SoundscapeEventRow) =>
      toSoundscapeBellIntent({
        event: {
          _id: String(event._id),
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
      }),
    [camera, systemsById, ownership, listenerEmpireId],
  );

  const playActivationPreview = useCallback((engine: GalaxySoundscapeEngine) => {
    const currentTurn = timeline?.currentTurn ?? null;
    const activationIntents = [...recentEvents]
      .reverse()
      .map(toBellIntent)
      .filter((intent): intent is NonNullable<typeof intent> => intent !== null)
      .filter((intent) => currentTurn === null || intent.turnNumber >= currentTurn - 1);

    const prioritized =
      currentTurn === null
        ? activationIntents.slice(-2)
        : [
            ...activationIntents.filter((intent) => intent.turnNumber === currentTurn),
            ...activationIntents.filter((intent) => intent.turnNumber === currentTurn - 1),
          ].slice(-3);

    if (prioritized.length === 0) {
      showNotice("Sound on. Waiting for next event.");
      return;
    }

    showNotice("Sound on. Sampling recent activity.");
    prioritized.forEach((intent, index) => {
      const timer = window.setTimeout(() => {
        pendingPlaybackTimersRef.current.delete(`activation:${intent.eventId}`);
        engine.playBell(intent);
      }, index * 140);
      pendingPlaybackTimersRef.current.set(`activation:${intent.eventId}`, timer);
    });
  }, [recentEvents, showNotice, timeline?.currentTurn, toBellIntent]);

  const disableSoundscape = useCallback(() => {
    startupTokenRef.current += 1;
    startupPromiseRef.current = null;
    clearPendingPlaybackTimers();
    clearNoticeTimer();
    engineRef.current?.dispose();
    engineRef.current = null;
    seenEventIdsRef.current = new Set();
    activeGameIdRef.current = activeGameId;
    setEnabled(false);
    setStatus("off");
    setError(null);
    setNotice(null);
    writeStoredEnabled(false);
  }, [activeGameId, clearNoticeTimer, clearPendingPlaybackTimers]);

  const enableSoundscape = useCallback(async () => {
    if (engineRef.current !== null) {
      setEnabled(true);
      setStatus("ready");
      setError(null);
      writeStoredEnabled(true);
      return;
    }

    if (startupPromiseRef.current !== null) {
      await startupPromiseRef.current;
      return;
    }

    const startupToken = startupTokenRef.current + 1;
    startupTokenRef.current = startupToken;
    const startupPromise = (async () => {
      setStatus("starting");
      setError(null);
      try {
        await ensureToneReady();
        const engine = await createGalaxySoundscapeEngine({
          turnDurationMs: timeline?.turnDurationMs ?? null,
        });
        if (!mountedRef.current || startupToken !== startupTokenRef.current) {
          engine.dispose();
          return;
        }
        engineRef.current = engine;
        activeGameIdRef.current = activeGameId;
        playUiSound("sound_enabled_confirm");
        playActivationPreview(engine);
        seenEventIdsRef.current = new Set(recentEvents.map((event) => String(event._id)));
        setEnabled(true);
        setStatus("ready");
        writeStoredEnabled(true);
      } catch (soundError) {
        if (!mountedRef.current || startupToken !== startupTokenRef.current) {
          return;
        }
        setEnabled(false);
        setStatus("error");
        setError(errorMessage(soundError));
        setNotice(null);
        writeStoredEnabled(false);
      } finally {
        if (startupTokenRef.current === startupToken) {
          startupPromiseRef.current = null;
        }
      }
    })();
    startupPromiseRef.current = startupPromise;
    await startupPromise;
  }, [activeGameId, playActivationPreview, recentEvents, timeline?.turnDurationMs]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      startupTokenRef.current += 1;
      startupPromiseRef.current = null;
      clearNoticeTimer();
      clearPendingPlaybackTimers();
      engineRef.current?.dispose();
      engineRef.current = null;
    };
  }, [clearNoticeTimer, clearPendingPlaybackTimers]);

  useEffect(() => {
    if (!enabled) {
      return;
    }
    if (!canAutoStart) {
      startupTokenRef.current += 1;
      startupPromiseRef.current = null;
      clearPendingPlaybackTimers();
      engineRef.current?.dispose();
      engineRef.current = null;
      setStatus("off");
      return;
    }
    if (engineRef.current !== null) {
      return;
    }
    void enableSoundscape();
  }, [canAutoStart, clearPendingPlaybackTimers, enabled, enableSoundscape]);

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
      const intent = toBellIntent(event);
      if (intent !== null) {
        const plannedDelayMs = playbackPlan.get(eventId)?.delayMs ?? 0;
        const foregroundDelayMs =
          intent.isListenerOwnedEvent || intent.importance >= 0.72 || intent.distanceRatio <= 0.28
            ? Math.min(plannedDelayMs, 220)
            : plannedDelayMs;
        const delayMs = clamp(foregroundDelayMs, 0, Math.max(0, plannedDelayMs));
        if (delayMs <= 16) {
          engine.playBell(intent);
          continue;
        }
        if (delayMs > 500) {
          showNotice("Sound on. Next event scheduled this turn.", 2200);
        }
        const timer = window.setTimeout(() => {
          pendingPlaybackTimersRef.current.delete(eventId);
          engineRef.current?.playBell(intent);
        }, delayMs);
        pendingPlaybackTimersRef.current.set(eventId, timer);
      }
    }
  }, [enabled, recentEvents, showNotice, timeline, toBellIntent]);

  return {
    soundscapeEnabled: enabled,
    soundscapeStatus: status,
    soundscapeError: error,
    soundscapeNotice: notice,
    enableSoundscape,
    disableSoundscape,
  };
}