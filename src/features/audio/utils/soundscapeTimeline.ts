export type SoundscapeTimelineSnapshot = {
  currentTurn: number;
  turnStartedAt: number | null;
  turnDurationMs: number;
  effectiveNowMs: number;
};

export type SoundscapeScheduledEvent = {
  eventId: string;
  delayMs: number;
  slotFraction: number;
};

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function lerp(from: number, to: number, amount: number): number {
  return from + (to - from) * amount;
}

function slotFraction(index: number, total: number): number {
  return clamp01((index + 0.5) / Math.max(1, total));
}

function scheduledFractionForTurn(params: {
  eventTurnNumber: number;
  currentTurn: number;
  slotFraction: number;
}): number {
  const { eventTurnNumber, currentTurn } = params;
  if (eventTurnNumber < currentTurn) {
    return lerp(0.04, 0.28, params.slotFraction);
  }
  return lerp(0.1, 0.94, params.slotFraction);
}

export function buildSoundscapePlaybackPlan<T extends { _id: string; turnNumber: number }>(params: {
  events: readonly T[];
  timeline: SoundscapeTimelineSnapshot | null;
}): SoundscapeScheduledEvent[] {
  const { events, timeline } = params;
  if (events.length === 0) {
    return [];
  }

  const eventsByTurn = new Map<number, T[]>();
  for (const event of events) {
    const bucket = eventsByTurn.get(event.turnNumber);
    if (bucket === undefined) {
      eventsByTurn.set(event.turnNumber, [event]);
    } else {
      bucket.push(event);
    }
  }

  return events.map((event) => {
    const turnEvents = eventsByTurn.get(event.turnNumber) ?? [event];
    const orderInTurn = turnEvents.findIndex((row) => row._id === event._id);
    const eventSlotFraction = slotFraction(orderInTurn < 0 ? 0 : orderInTurn, turnEvents.length);
    if (timeline === null || timeline.turnStartedAt === null) {
      return {
        eventId: event._id,
        delayMs: 0,
        slotFraction: eventSlotFraction,
      };
    }

    const scheduledFraction = scheduledFractionForTurn({
      eventTurnNumber: event.turnNumber,
      currentTurn: timeline.currentTurn,
      slotFraction: eventSlotFraction,
    });
    const scheduledAtMs =
      timeline.turnStartedAt + scheduledFraction * Math.max(1, timeline.turnDurationMs);
    return {
      eventId: event._id,
      delayMs: Math.max(0, Math.round(scheduledAtMs - timeline.effectiveNowMs)),
      slotFraction: scheduledFraction,
    };
  });
}

export function computeSoundscapeReverbTailSeconds(
  turnDurationMs: number | null | undefined,
): number {
  if (turnDurationMs === null || turnDurationMs === undefined || !Number.isFinite(turnDurationMs)) {
    return 12;
  }
  return Math.max(10, Math.min(22, turnDurationMs / 1000 + 2.5));
}