import { useMemo, useState } from "react";
import { usePaginatedQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useActiveGame } from "@/features/galaxy/hooks/useActiveGame";

// ─── Event taxonomy ───────────────────────────────────────────────────────────

type Category = "all" | "combat" | "economy" | "fleet" | "traders" | "empire" | "sim";

const CATEGORY_EVENT_TYPES: Record<Exclude<Category, "all">, string[]> = {
  combat: [
    "battle_started",
    "battle_round_resolved",
    "battle_continues",
    "collateral_damage_applied",
    "system_conquered",
    "system_held",
  ],
  economy: [
    "food_crisis_started",
    "system_abandoned_underpopulation",
  ],
  fleet: [
    "fleet_arrived",
    "fleet_dispatched",
  ],
  traders: [
    "bg_trader_dispatched",
    "bg_trader_delivered",
  ],
  empire: [
    "empire_collapse_started",
    "system_claimed",
  ],
  sim: [
    "turn_resolved",
  ],
};

// Reverse map: eventType → Category
const EVENT_TYPE_TO_CATEGORY: Record<string, Exclude<Category, "all">> = {};
for (const [cat, types] of Object.entries(CATEGORY_EVENT_TYPES)) {
  for (const t of types) {
    EVENT_TYPE_TO_CATEGORY[t] = cat as Exclude<Category, "all">;
  }
}

function categoryOf(eventType: string): Exclude<Category, "all"> {
  return EVENT_TYPE_TO_CATEGORY[eventType] ?? "sim";
}

// ─── Visual config ────────────────────────────────────────────────────────────

type StyleConfig = {
  icon: string;
  bg: string;
  text: string;
  ring: string;
};

const CATEGORY_STYLE: Record<Exclude<Category, "all">, StyleConfig> = {
  combat:  { icon: "⚔️",  bg: "bg-red-500/10",     text: "text-red-300",     ring: "ring-red-500/30" },
  economy: { icon: "🌾",  bg: "bg-amber-500/10",   text: "text-amber-300",   ring: "ring-amber-500/30" },
  fleet:   { icon: "🚀",  bg: "bg-sky-500/10",     text: "text-sky-300",     ring: "ring-sky-500/30" },
  traders: { icon: "📦",  bg: "bg-emerald-500/10", text: "text-emerald-300", ring: "ring-emerald-500/30" },
  empire:  { icon: "👑",  bg: "bg-purple-500/10",  text: "text-purple-300",  ring: "ring-purple-500/30" },
  sim:     { icon: "⚙️",  bg: "bg-st-border/30",   text: "text-st-muted",    ring: "ring-st-border" },
};

const EVENT_TYPE_LABEL: Record<string, string> = {
  battle_started:                    "Battle Started",
  battle_round_resolved:             "Battle Round",
  battle_continues:                  "Battle Continues",
  collateral_damage_applied:         "Collateral Damage",
  system_conquered:                  "System Conquered",
  system_held:                       "System Held",
  food_crisis_started:               "Food Crisis",
  system_abandoned_underpopulation:  "Colony Abandoned",
  fleet_arrived:                     "Fleet Arrived",
  fleet_dispatched:                  "Fleet Dispatched",
  bg_trader_dispatched:              "Trader Dispatched",
  bg_trader_delivered:               "Trader Delivered",
  empire_collapse_started:           "Empire Collapsed",
  system_claimed:                    "System Claimed",
  turn_resolved:                     "Turn Resolved",
};

function eventLabel(eventType: string): string {
  return EVENT_TYPE_LABEL[eventType] ?? eventType.replace(/_/g, " ");
}

// ─── Category filter tabs ─────────────────────────────────────────────────────

const CATEGORY_TABS: { key: Category; label: string }[] = [
  { key: "all",     label: "All" },
  { key: "combat",  label: "Combat" },
  { key: "empire",  label: "Empire" },
  { key: "economy", label: "Economy" },
  { key: "fleet",   label: "Fleet" },
  { key: "traders", label: "Traders" },
  { key: "sim",     label: "Sim" },
];

// ─── Single event row ─────────────────────────────────────────────────────────

type EventDoc = {
  _id: string;
  _creationTime: number;
  gameId: string;
  turnNumber: number;
  eventType: string;
  actorType: string;
  actorId: string;
  targetType: string | null;
  targetId: string | null;
  summary: string;
  payload: string;
};

function EventRow({ event }: { event: EventDoc }) {
  const [expanded, setExpanded] = useState(false);
  const cat = categoryOf(event.eventType);
  const style = CATEGORY_STYLE[cat];

  let parsedPayload: unknown = null;
  try {
    parsedPayload = JSON.parse(event.payload);
  } catch {
    // non-JSON payload — show raw
  }

  const hasDetail =
    parsedPayload !== null &&
    typeof parsedPayload === "object" &&
    !Array.isArray(parsedPayload) &&
    Object.keys(parsedPayload).length > 0;

  return (
    <div className="group flex gap-3 py-2.5 border-b border-st-border/50 last:border-0">
      {/* Category icon */}
      <div
        className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] ring-1 ${style.bg} ${style.ring}`}
        title={cat}
      >
        {style.icon}
      </div>

      {/* Body */}
      <div className="min-w-0 flex-1 space-y-0.5">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          {/* Turn badge */}
          <span className="shrink-0 rounded bg-st-border/40 px-1.5 py-0.5 text-[10px] font-mono text-st-muted">
            T{event.turnNumber}
          </span>

          {/* Event type chip */}
          <span
            className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ring-1 ${style.bg} ${style.text} ${style.ring}`}
          >
            {eventLabel(event.eventType)}
          </span>

          {/* Summary */}
          <span className="text-sm text-st-fg">{event.summary}</span>
        </div>

        {/* Actor / target meta */}
        <p className="text-[10px] text-st-muted">
          {event.actorType}
          {event.targetType !== null ? ` → ${event.targetType}` : ""}
        </p>

        {/* Expandable payload */}
        {hasDetail && (
          <>
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="text-[10px] text-st-muted underline hover:text-st-fg transition-colors"
            >
              {expanded ? "hide details" : "show details"}
            </button>
            {expanded && (
              <pre className="mt-1 overflow-x-auto rounded bg-st-bg px-2 py-1.5 text-[10px] text-st-muted ring-1 ring-st-border">
                {JSON.stringify(parsedPayload, null, 2)}
              </pre>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ─── Turn group header ────────────────────────────────────────────────────────

function TurnDivider({ turn }: { turn: number }) {
  return (
    <div className="flex items-center gap-3 pt-4 pb-1 first:pt-0">
      <span className="shrink-0 rounded bg-st-accent/15 px-2.5 py-0.5 text-xs font-semibold text-st-accent ring-1 ring-st-accent/30">
        Turn {turn}
      </span>
      <div className="h-px flex-1 bg-st-border/40" />
    </div>
  );
}

// ─── Main screen ──────────────────────────────────────────────────────────────

const PAGE_SIZE = 40;

export function HistoryScreen(props: { hideGamePicker?: boolean }) {
  const hideGamePicker = props.hideGamePicker === true;
  const { games, activeGame, setSelectedGameId } = useActiveGame();
  const [category, setCategory] = useState<Category>("all");

  // Derive the single eventType filter: only works for categories with exactly
  // one event type — for multi-type categories we fetch all and filter client-side.
  const singleTypeFilter = useMemo((): string | undefined => {
    // We always pass undefined so pagination uses the broad by_gameId index,
    // then filter client-side by category. This keeps the query key stable and
    // avoids resets when toggling categories.
    return undefined;
  }, []);

  const { results, status, loadMore } = usePaginatedQuery(
    api.sim.queries.listEventsPaginated,
    activeGame
      ? {
          gameId: activeGame._id,
          eventType: singleTypeFilter,
        }
      : "skip",
    { initialNumItems: PAGE_SIZE },
  );

  // Client-side category filter
  const filteredEvents = useMemo(() => {
    if (category === "all") return results;
    const allowed = new Set(CATEGORY_EVENT_TYPES[category]);
    return results.filter((e) => allowed.has(e.eventType));
  }, [results, category]);

  // Group consecutive events by turn number for the divider UI
  type Group = { turn: number; events: typeof filteredEvents };
  const grouped = useMemo((): Group[] => {
    const groups: Group[] = [];
    for (const event of filteredEvents) {
      const last = groups[groups.length - 1];
      if (last !== undefined && last.turn === event.turnNumber) {
        last.events.push(event);
      } else {
        groups.push({ turn: event.turnNumber, events: [event] });
      }
    }
    return groups;
  }, [filteredEvents]);

  const isLoading = status === "LoadingFirstPage";
  const canLoadMore = status === "CanLoadMore";

  const categoryCount = useMemo(() => {
    const counts: Partial<Record<Category, number>> = {};
    for (const e of results) {
      const c = categoryOf(e.eventType);
      counts[c] = (counts[c] ?? 0) + 1;
    }
    return counts;
  }, [results]);

  return (
    <div className="space-y-4">
      {/* Game selector */}
      {!hideGamePicker ? (
      <Card>
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-st-muted shrink-0">
            Game
          </h2>
          <div className="flex flex-wrap gap-2">
            {games.map((g) => (
              <button
                key={g._id}
                type="button"
                onClick={() => setSelectedGameId(g._id)}
                className={`rounded-md px-3 py-1 text-sm transition-colors ${
                  activeGame?._id === g._id
                    ? "bg-st-accent text-slate-950 font-medium"
                    : "border border-st-border text-st-muted hover:text-st-fg"
                }`}
              >
                {g.name}
              </button>
            ))}
          </div>
          {activeGame != null && (
            <span className="ml-auto text-xs text-st-muted shrink-0">
              Turn {activeGame.currentTurn} · {results.length} events loaded
            </span>
          )}
        </div>
      </Card>
      ) : null}

      {activeGame == null ? (
        <Card>
          <p className="text-sm text-st-muted text-center py-8">
            {hideGamePicker
              ? "No active game is selected. Choose a game from the main StarStrat Games page, then return to this player view."
              : "Select a game above to view its event history."}
          </p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[220px_1fr]">
          {/* ── Sidebar: category filter ── */}
          <div className="space-y-1">
            <Card className="p-3">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-st-muted mb-2">
                Filter by category
              </p>
              {CATEGORY_TABS.map(({ key, label }) => {
                const count = key === "all"
                  ? results.length
                  : categoryCount[key] ?? 0;
                const style = key === "all" ? null : CATEGORY_STYLE[key];
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setCategory(key)}
                    className={`flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-sm transition-colors ${
                      category === key
                        ? "bg-st-accent/15 text-st-fg font-medium ring-1 ring-st-accent/30"
                        : "text-st-muted hover:text-st-fg hover:bg-st-border/30"
                    }`}
                  >
                    <span className="flex items-center gap-1.5">
                      {style !== null && (
                        <span className="text-xs">{style.icon}</span>
                      )}
                      {label}
                    </span>
                    {count > 0 && (
                      <span className="rounded-full bg-st-border/50 px-1.5 py-0.5 text-[10px] text-st-muted tabular-nums">
                        {count}
                      </span>
                    )}
                  </button>
                );
              })}
            </Card>

            {/* Legend */}
            <Card className="p-3 space-y-1">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-st-muted mb-2">
                Legend
              </p>
              {Object.entries(CATEGORY_STYLE).map(([cat, style]) => (
                <div key={cat} className="flex items-center gap-2 text-xs text-st-muted">
                  <span>{style.icon}</span>
                  <span className="capitalize">{cat}</span>
                </div>
              ))}
            </Card>
          </div>

          {/* ── Main event feed ── */}
          <div className="space-y-2">
            {isLoading && (
              <Card>
                <p className="text-sm text-st-muted text-center py-8">Loading events…</p>
              </Card>
            )}

            {!isLoading && filteredEvents.length === 0 && (
              <Card>
                <p className="text-sm text-st-muted text-center py-8">
                  {category === "all"
                    ? "No events recorded yet."
                    : `No ${category} events in the loaded range.`}
                </p>
              </Card>
            )}

            {grouped.map((group) => (
              <div key={group.turn}>
                <TurnDivider turn={group.turn} />
                <Card className="py-1 px-4">
                  {group.events.map((event) => (
                    <EventRow key={event._id} event={event as EventDoc} />
                  ))}
                </Card>
              </div>
            ))}

            {/* Load more */}
            {(canLoadMore || status === "LoadingMore") && (
              <div className="flex justify-center pt-2">
                <Button
                  variant="secondary"
                  disabled={status === "LoadingMore"}
                  onClick={() => loadMore(PAGE_SIZE)}
                  className="min-w-[160px]"
                >
                  {status === "LoadingMore" ? "Loading…" : "Load older events"}
                </Button>
              </div>
            )}

            {status === "Exhausted" && results.length > 0 && (
              <p className="text-center text-xs text-st-muted py-3">
                All {results.length} events loaded
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
