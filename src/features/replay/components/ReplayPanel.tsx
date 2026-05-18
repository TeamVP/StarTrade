import { useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { Card } from "@/components/ui/card";
import { useActiveGame } from "@/features/galaxy/hooks/useActiveGame";

type RecentReplayEvent = {
  _id: string;
  turnNumber: number;
  eventType: string;
  summary: string;
  actorType: string;
  targetType: string | null;
  actorLabel?: string | null;
  targetLabel?: string | null;
};

function formatEventTypeLabel(eventType: string): string {
  return eventType.split("_").join(" ");
}

export function ReplayPanel() {
  const { activeGame } = useActiveGame();
  const events =
    (useQuery(
      api.sim.queries.listRecentEvents,
      activeGame ? { gameId: activeGame._id, limit: 12 } : "skip",
    ) ?? []) as RecentReplayEvent[];

  return (
    <Card>
      <h2 className="text-sm font-semibold uppercase tracking-wide text-st-muted">
        Event log
      </h2>
      {events.length === 0 ? (
        <p className="mt-2 text-sm text-st-muted">No events yet — start and step turns.</p>
      ) : (
        <ul className="mt-3 max-h-48 space-y-2 overflow-y-auto text-xs">
          {events.map((event) => (
            <li key={event._id} className="border-b border-st-border pb-2 last:border-0">
              <span className="text-st-muted">T{event.turnNumber}</span>{" "}
              <span className="font-medium text-st-fg">{formatEventTypeLabel(event.eventType)}</span>
              <p className="text-st-muted">{event.summary}</p>
              {(event.actorLabel !== undefined && event.actorLabel !== null) ||
              (event.targetLabel !== undefined && event.targetLabel !== null) ? (
                <p className="text-st-muted/80">
                  {event.actorLabel ?? event.actorType}
                  {event.targetLabel !== undefined && event.targetLabel !== null
                    ? ` → ${event.targetLabel}`
                    : event.targetType !== null
                      ? ` → ${event.targetType}`
                      : ""}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
