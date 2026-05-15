import { useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { Card } from "@/components/ui/card";

function formatFinishReason(reason: string): string {
  return reason
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function parseStrategySummary(summaryJson: string | null): string | null {
  if (summaryJson === null) return null;
  try {
    const parsed = JSON.parse(summaryJson) as Record<string, unknown>;
    return typeof parsed.summary === "string" ? parsed.summary : null;
  } catch {
    return null;
  }
}

export function ResultsScreen(props: { playerView?: boolean }) {
  const playerView = props.playerView === true;
  const recentResults = useQuery(api.usr.queries.listRecentOfficialEmpireResults, { limit: 12 });
  const userLeaderboard = useQuery(api.usr.queries.listEmpireUserLeaderboard, { limit: 10 });
  const npcLeaderboard = useQuery(api.usr.queries.listEmpireNpcLeaderboard, { limit: 10 });
  const strategyLeaderboard = useQuery(api.usr.queries.listEmpireStrategyLeaderboard, {
    limit: 10,
  });

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-sm font-semibold uppercase tracking-wide text-st-muted">
              Results
            </h1>
            <p className="mt-1 max-w-3xl text-sm text-st-muted">
              Durable official outcomes retained after finished-game cleanup. Use this view to
              browse winners and compare players, NPCs, and automation strategies across games.
            </p>
          </div>
          <div className="rounded-md border border-st-border bg-st-bg px-3 py-2 text-xs text-st-muted">
            {playerView ? "Player view" : "Admin view"}
          </div>
        </div>
      </Card>

      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-st-muted">
              Recent Official Games
            </h2>
            <p className="mt-1 text-sm text-st-muted">
              Latest durable game outcomes, independent of live simulation retention.
            </p>
          </div>
          <div className="rounded-md border border-st-border bg-st-bg px-3 py-2 text-xs text-st-muted">
            {recentResults === undefined ? "..." : `${recentResults.length} results`}
          </div>
        </div>

        <div className="mt-4 grid gap-3">
          {recentResults === undefined ? (
            <p className="rounded-lg border border-st-border bg-st-bg px-3 py-4 text-sm text-st-muted">
              Loading recent results...
            </p>
          ) : recentResults.length === 0 ? (
            <p className="rounded-lg border border-st-border bg-st-bg px-3 py-4 text-sm text-st-muted">
              No official results yet.
            </p>
          ) : (
            recentResults.map((result) => (
              <div
                key={`${result.gameId}:${result.endedAt}`}
                className="rounded-lg border border-st-border bg-st-bg px-4 py-3"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <div className="font-medium text-st-fg">{result.name}</div>
                  <span className="rounded-full border border-st-border px-2 py-0.5 text-xs font-medium text-st-muted">
                    {result.mapKey}
                  </span>
                  <span className="rounded-full border border-st-border px-2 py-0.5 text-xs font-medium text-st-muted">
                    {formatFinishReason(result.finishReason)}
                  </span>
                </div>
                <p className="mt-1 text-sm text-st-muted">
                  {result.winner === null
                    ? "No winner recorded"
                    : `${result.winner.empireName} won${result.winner.playerName !== null ? ` as ${result.winner.playerName}` : ""}`}
                </p>
                <p className="mt-1 text-xs text-st-muted">
                  Ended {new Date(result.endedAt).toLocaleString()} · Score {result.winner?.scoreFinal ?? "-"}
                  {" "}· Stars {result.winner?.starsControlledFinal ?? "-"} · Fleet {result.winner?.fleetStrengthFinal ?? "-"}
                </p>
                {result.winner !== null && result.winner.strategySummaryJson !== null ? (
                  <p className="mt-1 text-xs text-st-muted">
                    Strategy: {parseStrategySummary(result.winner.strategySummaryJson) ?? "Recorded"}
                  </p>
                ) : null}
              </div>
            ))
          )}
        </div>
      </Card>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-st-muted">
            Player Leaderboard
          </h2>
          <div className="mt-4 space-y-2">
            {userLeaderboard === undefined ? (
              <p className="text-sm text-st-muted">Loading player leaderboard...</p>
            ) : userLeaderboard.length === 0 ? (
              <p className="text-sm text-st-muted">No player results yet.</p>
            ) : (
              userLeaderboard.map((row, index) => (
                <div
                  key={row.userId}
                  className="flex items-center justify-between gap-3 rounded border border-st-border bg-st-bg px-3 py-2 text-sm"
                >
                  <div className="min-w-0">
                    <div className="font-medium text-st-fg">#{index + 1} {row.displayName ?? row.userId}</div>
                    <div className="text-xs text-st-muted">{row.games} games · {row.top3} top 3s</div>
                  </div>
                  <div className="text-right text-xs text-st-muted">
                    <div>{row.wins} wins</div>
                    <div>{row.score} score</div>
                  </div>
                </div>
              ))
            )}
          </div>
        </Card>

        <Card>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-st-muted">
            NPC Leaderboard
          </h2>
          <div className="mt-4 space-y-2">
            {npcLeaderboard === undefined ? (
              <p className="text-sm text-st-muted">Loading NPC leaderboard...</p>
            ) : npcLeaderboard.length === 0 ? (
              <p className="text-sm text-st-muted">No NPC results yet.</p>
            ) : (
              npcLeaderboard.map((row, index) => (
                <div
                  key={row.npcPlayerKey}
                  className="flex items-center justify-between gap-3 rounded border border-st-border bg-st-bg px-3 py-2 text-sm"
                >
                  <div className="min-w-0">
                    <div className="font-medium text-st-fg">#{index + 1} {row.latestPlayerName ?? row.npcPlayerKey}</div>
                    <div className="text-xs text-st-muted">{row.games} games · {row.top3} top 3s</div>
                  </div>
                  <div className="text-right text-xs text-st-muted">
                    <div>{row.wins} wins</div>
                    <div>{row.score} score</div>
                  </div>
                </div>
              ))
            )}
          </div>
        </Card>

        <Card>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-st-muted">
            Strategy Leaderboard
          </h2>
          <div className="mt-4 space-y-2">
            {strategyLeaderboard === undefined ? (
              <p className="text-sm text-st-muted">Loading strategy leaderboard...</p>
            ) : strategyLeaderboard.length === 0 ? (
              <p className="text-sm text-st-muted">No strategy results yet.</p>
            ) : (
              strategyLeaderboard.map((row, index) => (
                <div
                  key={row.strategyFingerprint}
                  className="rounded border border-st-border bg-st-bg px-3 py-2 text-sm"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="font-medium text-st-fg">#{index + 1} {row.strategyLibraryKey ?? row.strategySourceKind}</div>
                    <div className="text-right text-xs text-st-muted">
                      <div>{row.wins} wins</div>
                      <div>{row.score} score</div>
                    </div>
                  </div>
                  <div className="mt-1 text-xs text-st-muted">{row.games} games · {row.top3} top 3s</div>
                  {row.sampleStrategySummaryJson !== null ? (
                    <p className="mt-1 text-xs text-st-muted">
                      {parseStrategySummary(row.sampleStrategySummaryJson) ?? "Recorded strategy summary"}
                    </p>
                  ) : null}
                </div>
              ))
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}