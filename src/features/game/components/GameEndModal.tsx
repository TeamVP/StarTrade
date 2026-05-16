import { useState, useEffect } from "react";
import { useMutation, useQuery } from "convex/react";
import { useNavigate } from "react-router-dom";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { getGamePath } from "@/features/games/gameRoutes";
import { useGalaxyData } from "@/features/galaxy/hooks/useGalaxyData";
import { usePlayerEmpireId, usePlayerGameMembership } from "@/features/player/PlayerPreviewContext";

// ── Victory ──────────────────────────────────────────────────────────────────

function VictoryModal({
  empireName,
  missionKey,
  onDismiss,
}: {
  empireName: string | null;
  missionKey: string | null;
  onDismiss: () => void;
}) {
  const navigate = useNavigate();
  const resetMyStarterGame = useMutation(api.usr.mutations.resetMyStarterGame);
  const [playAgainBusy, setPlayAgainBusy] = useState(false);
  const [playAgainError, setPlayAgainError] = useState<string | null>(null);

  async function handlePlayAgain() {
    if (missionKey === null || playAgainBusy) {
      return;
    }

    setPlayAgainBusy(true);
    setPlayAgainError(null);
    try {
      const result = await resetMyStarterGame({ scenarioKey: missionKey });
      navigate(getGamePath({ gameId: result.gameId as Id<"sim_games"> }), { replace: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setPlayAgainError(message.replace(/^[\s\S]*?Error:\s*/g, "").trim());
    } finally {
      setPlayAgainBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4"
      role="presentation"
      onClick={onDismiss}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="victory-title"
        className="pointer-events-auto w-full max-w-md rounded-xl border border-amber-500/50 bg-st-bg p-8 shadow-2xl shadow-amber-500/10"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Crown decoration */}
        <div className="mb-5 flex items-center justify-center gap-3 text-amber-500/60">
          <span className="text-lg">✦</span>
          <span className="text-2xl text-amber-400">★</span>
          <span className="text-lg">✦</span>
        </div>

        <div className="mb-6 text-center">
          <h2
            id="victory-title"
            className="text-2xl font-bold uppercase tracking-widest text-amber-400"
          >
            Imperial Victory
          </h2>
          {empireName ? (
            <p className="mt-1 text-xs uppercase tracking-[0.35em] text-amber-500/70">
              {empireName} — Emperor of the Galaxy
            </p>
          ) : (
            <p className="mt-1 text-xs uppercase tracking-[0.35em] text-amber-500/70">
              Emperor of the Galaxy
            </p>
          )}
        </div>

        <div className="space-y-3 text-center leading-relaxed text-st-muted">
          <p>
            The last enemy banner has fallen. From the core worlds to the outermost
            frontier, every star shines forth your dominion.
          </p>
          <p className="italic text-st-fg/80">
            History will remember this day — and call it the beginning of your age.
          </p>
        </div>

        <div className="mt-8 flex flex-col items-center gap-4">
          <Button
            asChild
            className="w-full max-w-xs bg-amber-500 font-semibold tracking-wide text-slate-950 hover:bg-amber-400"
          >
            <Link to="/lobby">Back to Lobby</Link>
          </Button>
          <button
            type="button"
            className="text-xs text-st-muted transition-colors hover:text-st-fg disabled:cursor-not-allowed disabled:opacity-50"
            disabled={missionKey === null || playAgainBusy}
            onClick={() => {
              void handlePlayAgain();
            }}
          >
            {playAgainBusy ? "Working..." : "Play again!"}
          </button>
          {playAgainError !== null ? (
            <p className="max-w-xs text-center text-[11px] text-red-300" role="alert">
              {playAgainError}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

// ── Defeat ───────────────────────────────────────────────────────────────────

function DefeatModal({
  empireName,
  isResigned,
  onDismiss,
}: {
  empireName: string | null;
  isResigned: boolean;
  onDismiss: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/88 p-4"
      role="presentation"
      onClick={onDismiss}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="defeat-title"
        className="pointer-events-auto w-full max-w-md rounded-xl border border-slate-700/40 bg-st-bg p-8 shadow-2xl shadow-black/80"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Cold silence decoration */}
        <div className="mb-7 flex items-center justify-center tracking-[0.6em] text-slate-700">
          <span className="text-xs">· · ·</span>
        </div>

        <div className="mb-7 text-center">
          <h2
            id="defeat-title"
            className="text-2xl font-bold uppercase tracking-widest text-slate-300"
          >
            {isResigned ? "Throne Abandoned" : "Dominion Lost"}
          </h2>
          {empireName ? (
            <p className="mt-2 text-xs uppercase tracking-[0.32em] text-slate-600">
              {empireName} — Erased
            </p>
          ) : (
            <p className="mt-2 text-xs uppercase tracking-[0.32em] text-slate-600">
              A Would-Be Emperor — Forgotten
            </p>
          )}
        </div>

        <div className="space-y-2 text-center text-sm leading-relaxed text-slate-500">
          {isResigned ? (
            <p>You chose to walk away.</p>
          ) : (
            <p>The stars you held are gone.</p>
          )}
          <p>What you built was erased.</p>
          <p className="text-xs italic text-slate-600">The galaxy does not mourn.</p>
        </div>

        <div className="mt-9 flex flex-col items-center gap-3">
          <Button
            asChild
            variant="secondary"
            className="w-full max-w-xs border-slate-700/50 bg-slate-900/50 font-medium tracking-wide text-slate-400 hover:border-slate-600/50 hover:bg-slate-800/50 hover:text-slate-300"
          >
            <Link to="/lobby">Return to Lobby</Link>
          </Button>
          <button
            type="button"
            className="text-xs text-slate-700 transition-colors hover:text-slate-500"
            onClick={onDismiss}
          >
            Remain
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Controller ────────────────────────────────────────────────────────────────

/**
 * Displays a full-screen victory or defeat modal overlay 1 second after the
 * end condition is first detected. Renders nothing for spectators or while
 * game data is still loading.
 *
 * Victory  — game.status === "finished" and the player's empire is the winner.
 * Defeat   — player's empire has isCollapsed === true (zero stars + zero fleets).
 */
export function GameEndModal() {
  const empireId = usePlayerEmpireId();
  const membership = usePlayerGameMembership();
  const { activeGame, empires } = useGalaxyData();
  const activeMissionKey = activeGame?.missionKey ?? activeGame?.lobbyScenarioKey ?? null;
  const durableResult = useQuery(
    api.sim.queries.getDurableGameResult,
    activeGame !== null && activeGame.status === "finished" ? { gameId: activeGame._id } : "skip",
  );

  // Latched end-condition (set once, never reset)
  const [pendingKind, setPendingKind] = useState<"victory" | "defeat" | null>(null);
  // What the modal is currently showing (set after 1.5 s delay)
  const [modalKind, setModalKind] = useState<"victory" | "defeat" | null>(null);
  // True once the player has dismissed the modal (prevents re-showing)
  const [dismissed, setDismissed] = useState(false);
  const [lastKnownEmpireId, setLastKnownEmpireId] = useState<typeof empireId>(empireId);
  const [lastKnownEmpireKey, setLastKnownEmpireKey] = useState<string | null>(null);
  const [lastKnownEmpireName, setLastKnownEmpireName] = useState<string | null>(membership.empireName);
  // Latched once resigned; persists even if the empire record disappears after cleanup
  const [lastKnownResigned, setLastKnownResigned] = useState(false);

  useEffect(() => {
    if (empireId !== null) {
      setLastKnownEmpireId(empireId);
    }
  }, [empireId]);

  const resolvedEmpireId = empireId ?? lastKnownEmpireId;
  const playerEmpire = empires?.find((e) => e._id === resolvedEmpireId) ?? null;

  useEffect(() => {
    if (playerEmpire?.empireKey !== undefined) {
      setLastKnownEmpireKey(playerEmpire.empireKey);
    }
    if ((membership.empireName ?? playerEmpire?.name) !== undefined) {
      setLastKnownEmpireName(membership.empireName ?? playerEmpire?.name ?? null);
    }
    if (playerEmpire?.resignedAt !== undefined) {
      setLastKnownResigned(true);
    }
  }, [membership.empireName, playerEmpire]);

  const playerEmpireKey = playerEmpire?.empireKey ?? lastKnownEmpireKey;
  const playerPlacement =
    playerEmpireKey === null
      ? null
      : durableResult?.placements.find((row) => row.empireKey === playerEmpireKey) ?? null;

  // A resigned player can never receive the victory modal, even if the score-based
  // finalization recorded their empire as the winner (e.g. they had the most stars
  // at the moment they resigned a solo game).
  const playerResigned = playerEmpire?.resignedAt !== undefined || lastKnownResigned;

  const isVictory =
    !playerResigned &&
    activeGame?.status === "finished" &&
    ((playerPlacement?.isWinner ?? false) ||
      (activeGame.winnerEmpireKey !== null && playerEmpireKey !== null && playerEmpireKey === activeGame.winnerEmpireKey));

  const isDefeated =
    playerResigned ||
    playerEmpire?.isCollapsed === true ||
    (activeGame?.status === "finished" && playerPlacement !== null && !playerPlacement.isWinner);

  // Effect 1 — latch the end condition the first time it becomes true
  useEffect(() => {
    if (dismissed || pendingKind !== null) return;
    if (isVictory) setPendingKind("victory");
    else if (isDefeated) setPendingKind("defeat");
  }, [isVictory, isDefeated, pendingKind, dismissed]);

  // Effect 2 — show the modal after a 1.5 second delay once latched
  useEffect(() => {
    if (pendingKind === null) return;
    const timer = setTimeout(() => setModalKind(pendingKind), 1500);
    return () => clearTimeout(timer);
  }, [pendingKind]);

  function handleDismiss() {
    setModalKind(null);
    setDismissed(true);
  }

  const empireName = membership.empireName ?? playerEmpire?.name ?? lastKnownEmpireName;

  if (modalKind === "victory")
    return <VictoryModal empireName={empireName} missionKey={activeMissionKey} onDismiss={handleDismiss} />;
  if (modalKind === "defeat")
    return <DefeatModal empireName={empireName} isResigned={playerResigned} onDismiss={handleDismiss} />;
  return null;
}
