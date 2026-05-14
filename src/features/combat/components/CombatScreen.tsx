import { useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { Card } from "@/components/ui/card";
import { useGalaxyData } from "@/features/galaxy/hooks/useGalaxyData";

const COMBAT_EVENT_TYPES = new Set([
  "battle_started",
  "battle_round_resolved",
  "battle_continues",
  "collateral_damage_applied",
  "system_claimed",
  "system_conquered",
  "system_held",
]);

export function CombatScreen(props: {
  playerPerspective?: { empireId: Id<"emp_states">; label: string } | null;
}) {
  const playerPerspective = props.playerPerspective ?? null;
  const { activeGame, systems, empires } = useGalaxyData();
  const [selectedPerspectiveId, setSelectedPerspectiveId] = useState<string>(
    () =>
      playerPerspective !== null ? `empire:${playerPerspective.empireId}` : "all",
  );
  const recentEvents = useQuery(
    api.sim.queries.listRecentEvents,
    activeGame ? { gameId: activeGame._id, limit: 80 } : "skip",
  );
  const playersQuery = useQuery(
    api.usr.queries.listGamePlayersForAdmin,
    activeGame ? { gameId: activeGame._id, limit: 80 } : "skip",
  );
  const activeBattlesQuery = useQuery(
    api.cmb.queries.listActiveBattles,
    activeGame ? { gameId: activeGame._id, limit: 40 } : "skip",
  );
  const combatEvents = useMemo(
    () =>
      (recentEvents ?? []).filter((event) => COMBAT_EVENT_TYPES.has(event.eventType)),
    [recentEvents],
  );
  const systemNames = useMemo(
    () => Object.fromEntries(systems.map((system) => [system._id, system.name])),
    [systems],
  );
  const empireNames = useMemo(
    () => Object.fromEntries(empires.map((empire) => [empire._id, empire.name])),
    [empires],
  );
  const activeBattles = activeBattlesQuery ?? [];
  const perspectives = useMemo(
    () => [
      { id: "all", label: "All players", kind: "Shared view" },
      ...empires.map((empire) => ({
        id: `empire:${empire._id}`,
        label: empire.name,
        kind: "Empire",
      })),
      ...(playersQuery ?? []).map((player) => ({
        id: `player:${player.roleId}`,
        label: player.displayName,
        kind:
          player.role === "empire" && player.empireId !== null
            ? `Player · ${empireNames[player.empireId] ?? "Empire"}`
            : `Player · ${player.role}`,
      })),
    ],
    [empires, empireNames, playersQuery],
  );
  const selectedPerspective =
    perspectives.find((perspective) => perspective.id === selectedPerspectiveId) ??
    perspectives[0];
  const messagesTitle =
    playerPerspective !== null ? playerPerspective.label : selectedPerspective.label;

  return (
    <div className="space-y-4">
      <Card>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-st-muted">
          Combat
        </h2>
        {playerPerspective === null ? (
          <p className="mt-2 text-sm text-st-muted">
            Switch between empire and player perspectives to inspect their combat message feed. For
            now every perspective receives the same shared messages.
          </p>
        ) : (
          <p className="mt-2 text-sm text-st-muted">
            Combat overview and the message stream for your empire.
          </p>
        )}
      </Card>
      {playerPerspective === null ? (
        <Card>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-st-muted">
            Message Perspective
          </h3>
          <div className="mt-3 flex flex-wrap gap-2">
            {perspectives.map((perspective) => (
              <button
                key={perspective.id}
                type="button"
                onClick={() => setSelectedPerspectiveId(perspective.id)}
                className={
                  perspective.id === selectedPerspective.id
                    ? "rounded-lg border border-st-accent bg-st-accent px-3 py-2 text-left text-sm font-medium text-slate-950"
                    : "rounded-lg border border-st-border bg-st-bg px-3 py-2 text-left text-sm text-st-fg hover:border-st-accent"
                }
              >
                <span className="block">{perspective.label}</span>
                <span className="block text-xs opacity-75">{perspective.kind}</span>
              </button>
            ))}
          </div>
        </Card>
      ) : null}
      <Card>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-st-muted">
          Active Battles
        </h3>
        {activeBattles.length === 0 ? (
          <p className="mt-3 text-sm text-st-muted">
            No active battles are currently unresolved.
          </p>
        ) : (
          <ul className="mt-3 space-y-3 text-sm">
            {activeBattles.map((battle) => {
              return (
                <li
                  key={battle._id}
                  className="rounded-lg border border-st-border bg-st-bg/60 p-3"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="font-medium text-st-fg">
                        {systemNames[battle.systemId] ?? "Unknown system"}
                      </div>
                      <p className="mt-1 text-xs text-st-muted">
                        {empireNames[battle.attackerEmpireId] ?? "Attacker"} attacking{" "}
                        {empireNames[battle.defenderEmpireId] ?? "Defender"} · round{" "}
                        {battle.roundNumber}
                      </p>
                      <p className="mt-1 text-xs text-st-muted">
                        Attackers: {battle.attackerShips} ships · Defenders:{" "}
                        {battle.defenderShips} ships
                      </p>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Card className="min-h-[200px]">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-st-muted">
          Messages For {messagesTitle}
        </h3>
        {playerPerspective === null ? (
          <p className="mt-1 text-xs text-st-muted">
            Current rule: all perspectives see this same shared combat feed.
          </p>
        ) : null}
        {combatEvents.length === 0 ? (
          <p className="mt-3 text-sm text-st-muted">
            No combat events yet. Send a fleet to a hostile star and step turns through
            arrival.
          </p>
        ) : (
          <ul className="mt-3 max-h-[420px] space-y-2 overflow-y-auto text-sm">
            {combatEvents.map((event) => (
              <li
                key={event._id}
                className="rounded-lg border border-st-border bg-st-bg/60 p-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs text-st-muted">Turn {event.turnNumber}</span>
                  <span className="rounded bg-st-panel px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide text-st-muted">
                    {event.eventType.split("_").join(" ")}
                  </span>
                </div>
                <p className="mt-1 text-st-fg">{event.summary}</p>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
