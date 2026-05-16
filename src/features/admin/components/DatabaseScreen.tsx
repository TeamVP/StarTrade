import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { getGamePath, getGameRouteKey } from "@/features/games/gameRoutes";
import { useActiveGame } from "@/features/galaxy/hooks/useActiveGame";

function formatDateTime(value: number | null): string {
  if (value === null) return "-";
  return new Date(value).toLocaleString();
}

export function DatabaseScreen() {
  const { activeGame, games, setSelectedGameId } = useActiveGame();
  const health = useQuery(api.admin.queries.getDatabaseHealth, {
    gameId: activeGame?._id,
  });
  const runLegacyGameCleanupBatch = useMutation(api.admin.mutations.runLegacyGameCleanupBatch);

  const [cleanupBusy, setCleanupBusy] = useState<"official" | "discarded" | null>(null);
  const [cleanupResult, setCleanupResult] = useState<string | null>(null);

  async function runCleanup(defaultRetentionClass: "official" | "discarded") {
    setCleanupBusy(defaultRetentionClass);
    setCleanupResult(null);
    try {
      const result = await runLegacyGameCleanupBatch({
        limit: 16,
        defaultRetentionClass,
      });
      setCleanupResult(
        `Processed ${result.processed} games, finalized ${result.finalized}. Run again until it reaches 0 processed.`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setCleanupResult(message.replace(/^[\s\S]*?Error:\s*/g, "").trim());
    } finally {
      setCleanupBusy(null);
    }
  }

  if (health?.authorized === false) {
    return (
      <Card>
        <p className="text-sm text-st-muted">Authentication required.</p>
      </Card>
    );
  }

  const overview = health?.overview;
  const selected = health?.selectedGameTableStats;
  const tableStats: Array<{ label: string; stat: { count: number; capped: boolean } }> =
    selected === null || selected === undefined
      ? []
      : [
          { label: "sim_events", stat: selected.simEvents },
          { label: "sim_turns", stat: selected.simTurns },
          { label: "sim_turn_preparations", stat: selected.simTurnPreparations },
          { label: "sim_turn_preparation_ops", stat: selected.simTurnPreparationOps },
          { label: "gal_systems", stat: selected.galSystems },
          { label: "gal_links", stat: selected.galLinks },
          { label: "emp_states", stat: selected.empStates },
          { label: "emp_system_holdings", stat: selected.empSystemHoldings },
          { label: "emp_priority_stars", stat: selected.empPriorityStars },
          { label: "flt_fleets", stat: selected.fltFleets },
          { label: "flt_orders (current turn)", stat: selected.fltOrdersCurrentTurn },
          { label: "flt_garrison_routes", stat: selected.fltGarrisonRoutes },
          { label: "col_colony_ships", stat: selected.colonyShips },
          { label: "cmb_battles", stat: selected.cmbBattles },
          { label: "eco_market_snapshots", stat: selected.ecoMarketSnapshots },
          { label: "eco_system_outputs", stat: selected.ecoSystemOutputs },
          { label: "eco_bg_traders", stat: selected.ecoBgTraders },
          { label: "sim_game_results", stat: selected.simGameResults },
          { label: "emp_results", stat: selected.empResults },
        ];

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-sm font-semibold uppercase tracking-wide text-st-muted">
              Database
            </h1>
            <p className="mt-1 max-w-3xl text-sm text-st-muted">
              Operational health, sampled table pressure, and cleanup tooling for the Convex
              database. Terminal `npx convex run` calls are unauthenticated, so admin maintenance
              actions are exposed here instead.
            </p>
          </div>
          <div className="rounded-md border border-st-border bg-st-bg px-3 py-2 text-xs text-st-muted">
            {health === undefined ? "Loading..." : `${health.scannedGames} recent games scanned`}
          </div>
        </div>
      </Card>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-st-muted">
            Game Status
          </h2>
          <div className="mt-3 space-y-2 text-sm text-st-muted">
            <div>Lobby: <span className="font-medium text-st-fg">{overview?.statusCounts.lobby ?? "-"}</span></div>
            <div>Running: <span className="font-medium text-st-fg">{overview?.statusCounts.running ?? "-"}</span></div>
            <div>Paused: <span className="font-medium text-st-fg">{overview?.statusCounts.paused ?? "-"}</span></div>
            <div>Finished: <span className="font-medium text-st-fg">{overview?.statusCounts.finished ?? "-"}</span></div>
          </div>
        </Card>

        <Card>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-st-muted">
            Retention Mix
          </h2>
          <div className="mt-3 space-y-2 text-sm text-st-muted">
            <div>Official: <span className="font-medium text-st-fg">{overview?.retentionCounts.official ?? "-"}</span></div>
            <div>Discarded: <span className="font-medium text-st-fg">{overview?.retentionCounts.discarded ?? "-"}</span></div>
            <div>Archived debug: <span className="font-medium text-st-fg">{overview?.retentionCounts.archived_debug ?? "-"}</span></div>
            <div>Unset legacy: <span className="font-medium text-st-fg">{overview?.retentionCounts.unknown ?? "-"}</span></div>
          </div>
        </Card>

        <Card>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-st-muted">
            Finalization State
          </h2>
          <div className="mt-3 space-y-2 text-sm text-st-muted">
            <div>None: <span className="font-medium text-st-fg">{overview?.finalizationCounts.none ?? "-"}</span></div>
            <div>Pending results: <span className="font-medium text-st-fg">{overview?.finalizationCounts.pending_result_write ?? "-"}</span></div>
            <div>Results written: <span className="font-medium text-st-fg">{overview?.finalizationCounts.results_written ?? "-"}</span></div>
            <div>Pending cleanup: <span className="font-medium text-st-fg">{overview?.finalizationCounts.pending_cleanup ?? "-"}</span></div>
            <div>Cleaned: <span className="font-medium text-st-fg">{overview?.finalizationCounts.cleaned ?? "-"}</span></div>
            <div>Archived debug: <span className="font-medium text-st-fg">{overview?.finalizationCounts.archived_debug ?? "-"}</span></div>
            <div>Unset legacy: <span className="font-medium text-st-fg">{overview?.finalizationCounts.unknown ?? "-"}</span></div>
          </div>
        </Card>
      </div>

      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-st-muted">
              Cleanup Actions
            </h2>
            <p className="mt-1 text-sm text-st-muted">
              These actions process a bounded batch. Run them repeatedly until they report 0
              processed for the current backlog.
            </p>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button
            type="button"
            disabled={cleanupBusy !== null}
            onClick={() => void runCleanup("official")}
          >
            {cleanupBusy === "official" ? "Compacting…" : "Compact Existing Games"}
          </Button>
          <Button
            type="button"
            variant="secondary"
            disabled={cleanupBusy !== null}
            onClick={() => void runCleanup("discarded")}
          >
            {cleanupBusy === "discarded" ? "Discarding…" : "Discard Existing Games"}
          </Button>
        </div>
        {cleanupResult !== null ? (
          <p className="mt-3 text-sm text-st-muted">{cleanupResult}</p>
        ) : null}
      </Card>

      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-st-muted">
              Cleanup Backlog
            </h2>
            <p className="mt-1 text-sm text-st-muted">
              Recent finished or inactive games that still look eligible for result writing or cleanup.
            </p>
          </div>
          <div className="rounded-md border border-st-border bg-st-bg px-3 py-2 text-xs text-st-muted">
            {overview?.cleanupCandidateCount ?? "-"} candidates shown
          </div>
        </div>

        <div className="mt-4 space-y-2">
          {overview === undefined ? (
            <p className="text-sm text-st-muted">Loading cleanup backlog…</p>
          ) : overview.cleanupCandidates.length === 0 ? (
            <p className="text-sm text-st-muted">No backlog candidates found in the recent sample.</p>
          ) : (
            overview.cleanupCandidates.map((game) => (
              <div
                key={game.gameId}
                className="flex flex-col gap-2 rounded border border-st-border bg-st-bg px-3 py-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <p className="font-medium text-st-fg">{game.name}</p>
                  <p className="mt-1 text-xs text-st-muted">
                    {game.status} · turn {game.currentTurn} · retention {game.retentionClass ?? "unset"} · finalization {game.finalizationState ?? "unset"}
                  </p>
                  <p className="mt-1 text-xs text-st-muted">
                    Last activity {formatDateTime(game.lastMeaningfulActivityAt)} · abandonment eligible {formatDateTime(game.abandonmentEligibleAt)}
                  </p>
                  <a
                    href={getGamePath(game)}
                    className="mt-1 inline-block text-xs text-cyan-300 hover:text-cyan-200"
                  >
                    /game/{getGameRouteKey(game)}
                  </a>
                </div>
                <Button
                  type="button"
                  variant="secondary"
                  className="shrink-0"
                  onClick={() => setSelectedGameId(game.gameId)}
                >
                  Focus game
                </Button>
              </div>
            ))
          )}
        </div>
      </Card>

      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-st-muted">
              Selected Game Table Pressure
            </h2>
            <p className="mt-1 text-sm text-st-muted">
              Sampled row counts for the currently focused game. Counts are capped at 512 rows per table to stay safe in queries.
            </p>
          </div>
          <select
            className="rounded border border-st-border bg-st-bg px-3 py-2 text-sm"
            value={activeGame?._id ?? ""}
            onChange={(event) => {
              const value = event.target.value;
              if (value.length > 0) {
                setSelectedGameId(value as (typeof games)[number]["_id"]);
              }
            }}
          >
            {games.map((game) => (
              <option key={game._id} value={game._id}>
                {game.name}
              </option>
            ))}
          </select>
        </div>

        {selected === null || selected === undefined ? (
          <p className="mt-4 text-sm text-st-muted">No game selected.</p>
        ) : (
          <div className="mt-4 space-y-3">
            <p className="text-sm text-st-muted">
              <span className="font-medium text-st-fg">{selected.name}</span> · {selected.status} · turn {selected.currentTurn} · retention {selected.retentionClass ?? "unset"} · finalization {selected.finalizationState ?? "unset"}
            </p>
            <a
              href={getGamePath(selected)}
              className="text-xs text-cyan-300 hover:text-cyan-200"
            >
              /game/{getGameRouteKey(selected)}
            </a>
            <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
              {tableStats.map(({ label, stat }) => (
                <div key={label} className="rounded border border-st-border bg-st-bg px-3 py-2 text-sm">
                  <div className="font-medium text-st-fg">{label}</div>
                  <div className="mt-1 text-st-muted">
                    {stat.count}{stat.capped ? "+" : ""} rows sampled
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}