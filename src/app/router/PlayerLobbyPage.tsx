import { useNavigate } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useActiveGame } from "@/features/galaxy/hooks/useActiveGame";
import { usePlayerPreview } from "@/features/player/PlayerPreviewContext";
import { cn } from "@/lib/utils";

function formatDateTime(value: number | null): string {
  if (value === null) return "Not started";
  return new Date(value).toLocaleString();
}

function statusClassName(status: string): string {
  if (status === "running") return "border-emerald-500/30 bg-emerald-950/30 text-emerald-200";
  if (status === "paused") return "border-amber-500/30 bg-amber-950/30 text-amber-200";
  if (status === "finished") return "border-slate-500/30 bg-slate-950/30 text-slate-300";
  return "border-cyan-500/30 bg-cyan-950/30 text-cyan-200";
}

function formatStatus(status: string): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

export function PlayerLobbyPage() {
  const { activeGame, games, gamesLoading, selectedGameId, setSelectedGameId } = useActiveGame();
  const { basePath, empireName } = usePlayerPreview();
  const navigate = useNavigate();

  function selectGame(gameId: typeof selectedGameId) {
    setSelectedGameId(gameId);
    void navigate(basePath, { replace: true });
  }

  return (
    <div className="w-full px-4 py-4 sm:px-6">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-4">
        <Card>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="text-sm font-semibold uppercase tracking-wide text-st-muted">
                Player Lobby
              </h1>
              <p className="mt-2 max-w-3xl text-sm text-st-muted">
                Choose which game <span className="font-medium text-st-fg">{empireName}</span>{" "}
                participates in on <span className="font-mono text-st-fg">{basePath}</span>. The
                selected game is used by the map, empire, economy, fleet, combat, and history pages.
              </p>
            </div>
            <div className="rounded-md border border-st-border bg-st-bg px-3 py-2 text-xs text-st-muted">
              {gamesLoading ? "Loading..." : `${games.length} games`}
            </div>
          </div>
        </Card>

        {gamesLoading ? (
          <Card className="text-sm text-st-muted">Loading games...</Card>
        ) : games.length === 0 ? (
          <Card className="text-sm text-st-muted">
            No games are available yet. Ask an admin to create or seed a game first.
          </Card>
        ) : (
          <div className="grid gap-3">
            {games.map((game) => {
              const isActive = activeGame?._id === game._id;
              const isSelected = selectedGameId === game._id;
              return (
                <Card
                  key={game._id}
                  className={cn(
                    "flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between",
                    isActive ? "border-st-accent" : undefined,
                  )}
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-base font-semibold text-st-fg">{game.name}</h2>
                      <span
                        className={cn(
                          "rounded-full border px-2 py-0.5 text-xs font-medium",
                          statusClassName(game.status),
                        )}
                      >
                        {formatStatus(game.status)}
                      </span>
                      {isActive ? (
                        <span className="rounded-full border border-st-accent/40 bg-st-accent/10 px-2 py-0.5 text-xs font-medium text-st-accent">
                          Currently viewed
                        </span>
                      ) : null}
                    </div>
                    <dl className="mt-3 grid gap-2 text-sm text-st-muted sm:grid-cols-4">
                      <div>
                        <dt className="text-xs uppercase tracking-wide">Map</dt>
                        <dd className="mt-0.5 font-mono text-st-fg">{game.mapKey}</dd>
                      </div>
                      <div>
                        <dt className="text-xs uppercase tracking-wide">Turn</dt>
                        <dd className="mt-0.5 text-st-fg">{game.currentTurn}</dd>
                      </div>
                      <div>
                        <dt className="text-xs uppercase tracking-wide">Started</dt>
                        <dd className="mt-0.5 text-st-fg">{formatDateTime(game.startedAt)}</dd>
                      </div>
                      <div>
                        <dt className="text-xs uppercase tracking-wide">Game ID</dt>
                        <dd className="mt-0.5 truncate font-mono text-xs text-st-fg">
                          {game._id}
                        </dd>
                      </div>
                    </dl>
                  </div>
                  <Button
                    type="button"
                    variant={isSelected ? "secondary" : "primary"}
                    className="shrink-0"
                    disabled={isSelected}
                    onClick={() => selectGame(game._id)}
                  >
                    {isSelected ? "Selected" : "Select"}
                  </Button>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
