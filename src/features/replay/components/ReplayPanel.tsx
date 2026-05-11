import { useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { Card } from "@/components/ui/card";
import { useActiveGame } from "@/features/galaxy/hooks/useActiveGame";

export function ReplayPanel() {
  const { activeGame } = useActiveGame();
  const events =
    useQuery(
      api.sim.queries.listRecentEvents,
      activeGame ? { gameId: activeGame._id, limit: 12 } : "skip",
    ) ?? [];

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
              <span className="font-medium text-st-fg">{event.eventType}</span>
              <p className="text-st-muted">{event.summary}</p>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
