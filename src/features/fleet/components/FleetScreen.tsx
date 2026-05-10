import { FormEvent, useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useGalaxyData } from "@/features/galaxy/hooks/useGalaxyData";

export function FleetScreen() {
  const { activeGame, links } = useGalaxyData();
  const gameId = activeGame?._id;
  const fleets =
    useQuery(
      api.flt.queries.listFleetsForGame,
      gameId ? { gameId, limit: 50 } : "skip",
    ) ?? [];
  const systems =
    useQuery(
      api.gal.queries.listSystems,
      gameId ? { gameId, limit: 50 } : "skip",
    ) ?? [];

  const issueFleetOrder = useMutation(api.flt.mutations.issueFleetOrder);
  const [fleetId, setFleetId] = useState<Id<"flt_fleets"> | "">("");
  const [targetId, setTargetId] = useState<Id<"gal_systems"> | "">("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!gameId || !activeGame || fleetId === "" || targetId === "") return;
    if (activeGame.status !== "running") return;

    setBusy(true);
    try {
      await issueFleetOrder({
        gameId,
        fleetId,
        turnNumber: activeGame.currentTurn,
        orderType: "move",
        targetSystemId: targetId,
      });
    } finally {
      setBusy(false);
    }
  }

  const selectedFleet = fleets.find((f) => f._id === fleetId);

  const neighborSystemIds = useMemo(() => {
    if (selectedFleet === undefined) return new Set<string>();
    const ids = new Set<string>();
    const origin = selectedFleet.originSystemId;
    for (const link of links) {
      if (link.fromSystemId === origin) ids.add(link.toSystemId);
      if (link.toSystemId === origin) ids.add(link.fromSystemId);
    }
    return ids;
  }, [links, selectedFleet]);

  const linkedTargets = systems.filter((s) => neighborSystemIds.has(s._id));

  return (
    <div className="space-y-4">
      <Card>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-st-muted">
          Fleet orders
        </h2>
        <p className="mt-2 text-sm text-st-muted">
          Issue a move order for the{" "}
          <strong className="text-st-fg">current turn</strong>, then use{" "}
          <strong className="text-st-fg">Step turn</strong> on the Galaxy page.
        </p>
        <form className="mt-4 space-y-2" onSubmit={(e) => void onSubmit(e)}>
          <label className="block text-xs text-st-muted">
            Fleet
            <select
              className="mt-1 w-full rounded border border-st-border bg-st-bg px-2 py-2 text-sm text-st-fg"
              value={fleetId}
              onChange={(event) => setFleetId(event.target.value as Id<"flt_fleets">)}
              disabled={!gameId || fleets.length === 0}
            >
              <option value="">Select fleet</option>
              {fleets.map((fleet) => (
                <option key={fleet._id} value={fleet._id}>
                  {fleet.name} ({fleet.status}, origin #{fleet.originSystemId.slice(-4)})
                </option>
              ))}
            </select>
          </label>
          <label className="block text-xs text-st-muted">
            Target system (direct link only)
            <select
              className="mt-1 w-full rounded border border-st-border bg-st-bg px-2 py-2 text-sm text-st-fg"
              value={targetId}
              onChange={(event) => setTargetId(event.target.value as Id<"gal_systems">)}
              disabled={selectedFleet === undefined}
            >
              <option value="">Select system</option>
              {linkedTargets.map((system) => (
                <option key={system._id} value={system._id}>
                  {system.name}
                </option>
              ))}
            </select>
          </label>
          <Button
            type="submit"
            className="w-full"
            disabled={
              busy ||
              !gameId ||
              activeGame?.status !== "running" ||
              fleetId === "" ||
              targetId === ""
            }
          >
            {busy ? "Sending…" : "Issue move order"}
          </Button>
        </form>
      </Card>

      <Card className="border-dashed">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-st-muted">
          Fleet status
        </h3>
        <ul className="mt-2 space-y-2 text-sm">
          {fleets.map((fleet) => (
            <li key={fleet._id} className="flex flex-wrap justify-between gap-2">
              <span>{fleet.name}</span>
              <span className="text-st-muted">
                {fleet.status}
                {fleet.status === "enRoute" && fleet.etaTurn !== null
                  ? ` · ETA turn ${fleet.etaTurn}`
                  : ""}
              </span>
            </li>
          ))}
        </ul>
        {fleets.length === 0 ? (
          <p className="mt-2 text-xs text-st-muted">Seed a game to spawn fleets.</p>
        ) : null}
      </Card>
    </div>
  );
}
