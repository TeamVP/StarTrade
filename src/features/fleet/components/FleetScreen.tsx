import { FormEvent, useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { useNavigate } from "react-router-dom";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useGalaxyData } from "@/features/galaxy/hooks/useGalaxyData";
import { gameAllowsPlayerOrders } from "@/features/sim/gameStatus";
import { normalizeFleetDetachmentDisplayName } from "@/lib/fleetDisplayName";

export function FleetScreen(props: {
  playerEmpireId?: Id<"emp_states"> | null;
  galaxyPath?: string;
}) {
  const playerEmpireId = props.playerEmpireId ?? null;
  const galaxyPath = props.galaxyPath ?? "/";
  const navigate = useNavigate();
  const { activeGame, links } = useGalaxyData();
  const ordersAllowed = gameAllowsPlayerOrders(activeGame?.status);
  const gameId = activeGame?._id;
  const fleetsQuery = useQuery(
    api.flt.queries.listFleetsForGame,
    gameId ? { gameId, limit: 256 } : "skip",
  );
  const systemsQuery = useQuery(
    api.gal.queries.listSystems,
    gameId ? { gameId, limit: 256 } : "skip",
  );
  const myRolesQuery = useQuery(
    api.usr.queries.listMyRoles,
    gameId ? { gameId } : "skip",
  );
  const garrisonRoutesQuery = useQuery(
    api.flt.queries.listMyGarrisonRoutes,
    gameId ? { gameId } : "skip",
  );

  const fleets = useMemo(() => fleetsQuery ?? [], [fleetsQuery]);
  const systems = useMemo(() => systemsQuery ?? [], [systemsQuery]);
  const myRoles = useMemo(() => myRolesQuery ?? [], [myRolesQuery]);
  const garrisonRoutes = useMemo(() => garrisonRoutesQuery ?? [], [garrisonRoutesQuery]);

  const issueFleetOrder = useMutation(api.flt.mutations.issueFleetOrder);
  const setGarrisonRoute = useMutation(api.flt.mutations.setGarrisonRoute);
  const [fleetId, setFleetId] = useState<Id<"flt_fleets"> | "">("");
  const [targetId, setTargetId] = useState<Id<"gal_systems"> | "">("");
  const [shipCountInput, setShipCountInput] = useState("");
  const [busy, setBusy] = useState(false);

  const myEmpireId = useMemo(() => {
    if (playerEmpireId !== null) return playerEmpireId;
    const role = myRoles.find((r) => r.role === "empire");
    if (role === undefined || role.empireId === null) return null;
    return role.empireId;
  }, [myRoles, playerEmpireId]);

  const fleetsVisible = useMemo(() => {
    if (myEmpireId === null) return fleets;
    return fleets.filter((f) => f.empireId === myEmpireId);
  }, [fleets, myEmpireId]);

  const garrisonRoutesVisible = useMemo(() => {
    if (myEmpireId === null) return garrisonRoutes;
    return garrisonRoutes.filter((r) => r.empireId === myEmpireId);
  }, [garrisonRoutes, myEmpireId]);
  const ownedSystems = useMemo(() => {
    if (myEmpireId === null) return [];
    return systems.filter((s) => s.ownerEmpireId === myEmpireId);
  }, [systems, myEmpireId]);

  const [routeOriginId, setRouteOriginId] = useState<Id<"gal_systems"> | "">("");
  const [routeTargetId, setRouteTargetId] = useState<Id<"gal_systems"> | "">("");
  const [routePct, setRoutePct] = useState(25);
  const [routeEnabled, setRouteEnabled] = useState(true);
  const [routeBusy, setRouteBusy] = useState(false);

  function handleRouteOriginChange(nextId: Id<"gal_systems"> | "") {
    setRouteOriginId(nextId);
    if (nextId === "") return;
    const hit = garrisonRoutesVisible.find((r) => r.originSystemId === nextId);
    if (hit !== undefined) {
      setRouteTargetId(hit.destinationSystemId);
      setRoutePct(hit.dispatchPct);
      setRouteEnabled(hit.enabled);
    } else {
      setRouteTargetId("");
      setRoutePct(25);
      setRouteEnabled(true);
    }
  }

  const routeNeighborIds = useMemo(() => {
    if (routeOriginId === "") return new Set<string>();
    const ids = new Set<string>();
    for (const link of links) {
      if (link.fromSystemId === routeOriginId) ids.add(link.toSystemId);
      if (link.toSystemId === routeOriginId) ids.add(link.fromSystemId);
    }
    return ids;
  }, [links, routeOriginId]);

  const routeOrigin = routeOriginId === "" ? null : systems.find((s) => s._id === routeOriginId);
  const routeTargets = systems.filter(
    (s) =>
      routeNeighborIds.has(s._id) &&
      routeOrigin?.ownerEmpireId !== null &&
      routeOrigin?.ownerEmpireId !== undefined,
  );

  async function onSaveRoute(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!gameId || routeOriginId === "" || routeTargetId === "") return;
    if (!ordersAllowed) return;
    setRouteBusy(true);
    try {
      await setGarrisonRoute({
        gameId,
        originSystemId: routeOriginId,
        destinationSystemId: routeTargetId,
        dispatchPct: routePct,
        enabled: routeEnabled,
      });
    } finally {
      setRouteBusy(false);
    }
  }

  async function onClearRoute() {
    if (!gameId || routeOriginId === "") return;
    setRouteBusy(true);
    try {
      await setGarrisonRoute({
        gameId,
        originSystemId: routeOriginId,
        destinationSystemId: null,
        dispatchPct: 0,
        enabled: false,
      });
      setRouteTargetId("");
    } finally {
      setRouteBusy(false);
    }
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!gameId || !activeGame || fleetId === "" || targetId === "") return;
    if (!ordersAllowed) return;

    setBusy(true);
    try {
      const selected = fleetsVisible.find((f) => f._id === fleetId);
      if (selected === undefined) return;
      const trimmed = shipCountInput.trim();
      let partialShipCount: number | undefined;
      if (trimmed !== "") {
        partialShipCount = Number.parseInt(trimmed, 10);
        if (
          !Number.isInteger(partialShipCount) ||
          partialShipCount < 1 ||
          partialShipCount > selected.strength
        ) {
          return;
        }
      }

      await issueFleetOrder({
        gameId,
        fleetId,
        orderType: "move",
        targetSystemId: targetId,
        ...(partialShipCount !== undefined && partialShipCount < selected.strength
          ? { shipCount: partialShipCount }
          : {}),
      });
    } finally {
      setBusy(false);
    }
  }

  const selectedFleet = fleetsVisible.find((f) => f._id === fleetId);

  function syncShipPlaceholder() {
    if (selectedFleet === undefined) {
      setShipCountInput("");
      return;
    }
    const mid = Math.max(1, Math.floor(selectedFleet.strength / 2));
    setShipCountInput(String(Math.min(mid, selectedFleet.strength)));
  }

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

  function openFleetOnGalaxy(fleetIdToFocus: Id<"flt_fleets">) {
    void navigate(galaxyPath, { state: { focusFleetId: fleetIdToFocus } });
  }

  return (
    <div className="space-y-4">
      <Card>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-st-muted">
          Fleet orders
        </h2>
        <form className="mt-4 space-y-2" onSubmit={(e) => void onSubmit(e)}>
          <label className="block text-xs text-st-muted">
            Fleet
            <select
              className="mt-1 w-full rounded border border-st-border bg-st-bg px-2 py-2 text-sm text-st-fg"
              value={fleetId}
              onChange={(event) => {
                setFleetId(event.target.value as Id<"flt_fleets">);
                setShipCountInput("");
              }}
              disabled={!gameId || fleetsVisible.length === 0}
            >
              <option value="">Select fleet</option>
              {fleetsVisible.map((fleet) => (
                <option key={fleet._id} value={fleet._id}>
                  {normalizeFleetDetachmentDisplayName(fleet.name)} ({fleet.status}, origin #{fleet.originSystemId.slice(-4)})
                </option>
              ))}
            </select>
          </label>
          <label className="block text-xs text-st-muted">
            Ships to move (blank = entire fleet)
            <input
              type="number"
              min={1}
              placeholder={
                selectedFleet !== undefined
                  ? `max ${selectedFleet.strength}`
                  : "—"
              }
              value={shipCountInput}
              onChange={(e) => setShipCountInput(e.target.value)}
              onFocus={() => {
                if (shipCountInput === "" && selectedFleet !== undefined) {
                  syncShipPlaceholder();
                }
              }}
              className="mt-1 w-full rounded border border-st-border bg-st-bg px-2 py-2 text-sm text-st-fg"
              disabled={selectedFleet === undefined}
            />
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
              !ordersAllowed ||
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
        <ul className="mt-2 grid grid-cols-2 gap-x-3 gap-y-2 text-sm sm:grid-cols-[max-content_max-content] sm:justify-center sm:gap-x-6 sm:text-center">
          {fleetsVisible.map((fleet) => (
            <li key={fleet._id} className="contents">
              <button
                type="button"
                className="min-w-0 truncate justify-self-start rounded px-1 text-st-fg underline-offset-2 transition-colors hover:text-st-accent hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-st-accent sm:justify-self-center"
                onClick={() => openFleetOnGalaxy(fleet._id)}
              >
                {normalizeFleetDetachmentDisplayName(fleet.name)}
              </button>
              <span className="min-w-0 justify-self-start text-st-muted sm:justify-self-center">
                {fleet.strength} ships · {fleet.status}
                {fleet.status === "enRoute" && fleet.etaTurn !== null
                  ? ` · ETA turn ${fleet.etaTurn}`
                  : ""}
              </span>
            </li>
          ))}
        </ul>
        {fleetsVisible.length === 0 ? (
          <p className="mt-2 text-xs text-st-muted">Seed a game to spawn fleets.</p>
        ) : null}
      </Card>

      <Card>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-st-muted">
          Standing garrison routes
        </h2>
        <p className="mt-2 text-sm text-st-muted">
          After production each turn, automatically sends a share of your{" "}
          <strong className="text-st-fg">idle ships</strong> at the chosen system toward a{" "}
          <strong className="text-st-fg">linked neighbor</strong>, so fleets stack at rally points.
        </p>
        {myEmpireId === null ? (
          <p className="mt-3 text-xs text-st-muted">
            Join this game as an <strong className="text-st-fg">empire</strong> player to configure
            routes from systems you own.
          </p>
        ) : (
          <>
            <form className="mt-4 space-y-3" onSubmit={(e) => void onSaveRoute(e)}>
              <label className="block text-xs text-st-muted">
                Origin (your system)
                <select
                  className="mt-1 w-full rounded border border-st-border bg-st-bg px-2 py-2 text-sm text-st-fg"
                  value={routeOriginId}
                  onChange={(e) =>
                    handleRouteOriginChange(e.target.value as Id<"gal_systems"> | "")
                  }
                  disabled={!gameId || ownedSystems.length === 0}
                >
                  <option value="">Select system</option>
                  {ownedSystems.map((s) => (
                    <option key={s._id} value={s._id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-xs text-st-muted">
                Destination (direct link)
                <select
                  className="mt-1 w-full rounded border border-st-border bg-st-bg px-2 py-2 text-sm text-st-fg"
                  value={routeTargetId}
                  onChange={(e) =>
                    setRouteTargetId(e.target.value as Id<"gal_systems"> | "")
                  }
                  disabled={routeOriginId === ""}
                >
                  <option value="">Select neighbor</option>
                  {routeTargets.map((s) => (
                    <option key={s._id} value={s._id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>
              <div>
                <label className="block text-xs text-st-muted" htmlFor="route-pct">
                  Share of idle garrison each turn: {routePct}%
                </label>
                <input
                  id="route-pct"
                  type="range"
                  min={0}
                  max={100}
                  step={1}
                  value={routePct}
                  onChange={(e) => setRoutePct(Number(e.target.value))}
                  className="mt-2 w-full accent-st-primary"
                  disabled={routeOriginId === ""}
                />
              </div>
              <label className="flex items-center gap-2 text-xs text-st-muted">
                <input
                  type="checkbox"
                  checked={routeEnabled}
                  onChange={(e) => setRouteEnabled(e.target.checked)}
                  disabled={routeOriginId === ""}
                />
                Route active (uncheck to pause without deleting)
              </label>
              <div className="flex gap-2">
                <Button
                  type="submit"
                  className="flex-1"
                  disabled={
                    routeBusy ||
                    !gameId ||
                    !ordersAllowed ||
                    routeOriginId === "" ||
                    routeTargetId === ""
                  }
                >
                  {routeBusy ? "Saving…" : "Save route"}
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={
                    routeBusy || !gameId || routeOriginId === "" || !ordersAllowed
                  }
                  onClick={() => void onClearRoute()}
                >
                  Clear
                </Button>
              </div>
            </form>
            {garrisonRoutesVisible.length > 0 ? (
              <ul className="mt-4 space-y-1 border-t border-st-border pt-3 text-xs text-st-muted">
                {garrisonRoutesVisible.map((r) => {
                  const o = systems.find((s) => s._id === r.originSystemId);
                  const d = systems.find((s) => s._id === r.destinationSystemId);
                  return (
                    <li key={r._id}>
                      {o?.name ?? "?"} → {d?.name ?? "?"} · {r.dispatchPct}% ·{" "}
                      {r.enabled ? "on" : "paused"}
                      {r.managedByStrategy === true ? (
                        <span className="text-slate-400"> · automation</span>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </>
        )}
      </Card>
    </div>
  );
}
