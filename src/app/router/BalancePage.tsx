import { useActiveGame } from "@/features/galaxy/hooks/useActiveGame";
import { BalancePanel } from "@/features/admin/components/BalancePanel";

export function BalancePage() {
  const { activeGame, games, setSelectedGameId } = useActiveGame();

  return (
    <div className="mx-auto max-w-2xl px-4 py-6 space-y-6">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold text-st-fg">Balance Settings</h1>
        <p className="text-sm text-st-muted">
          Adjust game balance parameters in real-time. Changes take effect at the start of the
          next turn resolution.
        </p>
      </div>

      {/* Game selector */}
      {games.length > 1 && (
        <div className="flex flex-wrap gap-2">
          {games.map((game) => {
            const isActive = activeGame?._id === game._id;
            return (
              <button
                key={game._id}
                type="button"
                onClick={() => setSelectedGameId(game._id)}
                className={`rounded-md px-3 py-1.5 text-sm transition-colors border ${
                  isActive
                    ? "border-st-accent bg-st-accent/10 text-st-fg ring-1 ring-st-accent/30"
                    : "border-st-border text-st-muted hover:bg-st-panel hover:text-st-fg"
                }`}
              >
                {game.name}
                <span className="ml-1.5 text-xs opacity-60">{game.status}</span>
              </button>
            );
          })}
        </div>
      )}

      {activeGame === null ? (
        <div className="rounded-lg border border-st-border bg-st-panel p-8 text-center">
          <p className="text-sm text-st-muted">
            No game found. Create a game from the Admin panel first.
          </p>
        </div>
      ) : (
        <>
          <div className="flex items-center gap-2 text-xs text-st-muted">
            <span className="font-medium text-st-fg">{activeGame.name}</span>
            <span>·</span>
            <span
              className={`rounded px-1.5 py-0.5 font-mono uppercase tracking-wide ${
                activeGame.status === "running"
                  ? "bg-emerald-900/40 text-emerald-400"
                  : activeGame.status === "paused"
                    ? "bg-amber-900/40 text-amber-400"
                    : "bg-st-panel text-st-muted"
              }`}
            >
              {activeGame.status}
            </span>
            <span>· Turn {activeGame.currentTurn}</span>
          </div>

          <BalancePanel gameId={activeGame._id} gameMode={activeGame.mode} />
        </>
      )}
    </div>
  );
}
