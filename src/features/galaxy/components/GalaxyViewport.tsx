import {
  startTransition,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useMutation, useQuery } from "convex/react";
import { Expand, Info, Minus, Plus, Repeat2, Star, Volume2, VolumeX } from "lucide-react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { useGalaxySoundscape } from "@/features/audio/hooks/useGalaxySoundscape";
import { formatPopulationPeople } from "@/lib/populationFormat";
import { normalizeFleetDetachmentDisplayName } from "@/lib/fleetDisplayName";
import { Button } from "@/components/ui/button";
import {
  COLONY_ORBIT_ANGLE_OFFSET_RAD,
  COLONY_ORBIT_RADIUS,
  FLEET_ORBIT_RADIUS,
  GALAXY_STAGE_HEIGHT,
  GALAXY_STAGE_WIDTH,
  MAP_BUTTON_ZOOM_FACTOR,
  MAP_CAMERA_TWEEN_MS,
  MAX_MAP_SCALE,
  MIN_MAP_SCALE,
  STAR_CLICK_RECENTER_FRACTION,
  STAR_CLICK_ZOOM_FRACTION,
} from "../constants";
import {
  clampMapScale,
  computeFitAllSystemsCamera,
  computeFitGalaxyHorizontal,
  computeFitGalaxyVertical,
  easeOutCubic,
  type GalaxyMapCamera,
} from "../utils/mapCamera";
import { turnTravelProgress } from "../utils/turnTravelProgress";
import { useGalaxyMapNav } from "../context/GalaxyMapNavContext";
import { useGalaxyData } from "../hooks/useGalaxyData";
import {
  GalaxyStage,
  type ColonyShipMarkerModel,
  type ColonyShipRouteCommitPayload,
  type CombatMarkerModel,
  type EnRouteGhostModel,
  type FleetMarkerModel,
  type FoodAlertNode,
  type GalaxyLink,
  type GalaxyNode,
  type MothershipDamageReplayModel,
  type PendingSegmentModel,
  type RouteSegmentModel,
  type StarvationNode,
  type TraderShipModel,
  type TurnTimelineModel,
} from "../pixi/GalaxyStage";
import type { GalaxyLinkRow } from "../utils/linkAdjacency";
import { gameAllowsPlayerOrders as gameAllowsOrders } from "@/features/sim/gameStatus";
import {
  equilibriumShipsPct,
  FOOD_PRICE_DEFAULT_CR,
  foodDemandForStockThresholds,
  foodProdDemandDisplay,
  foodStockpileBand,
  previewColonyFoodFlows,
} from "@/lib/simFoodEconomy";
import {
  COLONY_NEW_WORLD_FOOD_BONUS_PER_TURN,
  COLONY_SHIP_BUILD_TURNS,
  MAX_COLONY_ROUTE_HOPS_BEYOND_EMPIRE,
} from "../../../../convex/col/constants";
import { validateColonyShipRouteDestinations } from "../../../../convex/col/routeValidation";

/** Matches `POPULATION_MIN_INHABITED_PEOPLE` in Convex — worlds below this are “empty” for colonization. */
const MIN_INHABITED_POPULATION = 1000;

/** Zoom when focusing a fleet from the planet panel: geometric mean of min/max map scale (~1.2×). */
const MAP_FLEET_FROM_PANEL_FOCUS_SCALE = clampMapScale(
  Math.sqrt(MIN_MAP_SCALE * MAX_MAP_SCALE),
);
/** Stronger focus when arriving from the Fleet page: 70% of the min→max zoom range. */
const MAP_FLEET_LINK_FOCUS_SCALE = clampMapScale(
  MIN_MAP_SCALE + (MAX_MAP_SCALE - MIN_MAP_SCALE) * 0.7,
);

function finiteCombatCount(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.floor(value))
    : Math.max(0, Math.floor(fallback));
}

function isEditableKeyboardTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tagName = target.tagName.toLowerCase();
  return (
    tagName === "input" ||
    tagName === "textarea" ||
    tagName === "select" ||
    target.isContentEditable
  );
}

type CombatEventRow = {
  _id: string;
  eventType: string;
  payload: string;
  turnNumber: number;
};

type CombatReplayDraft = {
  battleId: string;
  systemId: string;
  attackerEmpireId: string;
  defenderEmpireId: string;
  attackerShipsAtStart: number;
  defenderShipsAtStart: number;
  attackerMotherships: number;
  defenderMotherships: number;
  latestRound: {
    turnNumber: number;
    roundNumber: number;
    attackerShipsBefore: number;
    defenderShipsBefore: number;
    attackerShipsAfter: number;
    defenderShipsAfter: number;
    mothershipEvents: MothershipDamageReplayModel[];
  } | null;
};

function payloadRecord(payload: string): Record<string, unknown> | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return null;
  }
  return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : null;
}

function stringField(row: Record<string, unknown>, key: string): string | null {
  const value = row[key];
  return typeof value === "string" ? value : null;
}

function battleSideField(value: unknown): MothershipDamageReplayModel["side"] | null {
  return value === "attacker" || value === "defender" ? value : null;
}

function mothershipReplayEvents(value: unknown): MothershipDamageReplayModel[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) return [];
    const row = entry as Record<string, unknown>;
    const side = battleSideField(row.side);
    const colonyShipId = stringField(row, "colonyShipId");
    if (side === null || colonyShipId === null) return [];
    return [
      {
        side,
        colonyShipId,
        name: stringField(row, "name") ?? "Mothership",
        damageApplied: finiteCombatCount(row.damageApplied, 0),
        damageBefore: finiteCombatCount(row.damageBefore, 0),
        damageAfter: finiteCombatCount(row.damageAfter, 0),
        destroyed: row.destroyed === true,
      },
    ];
  });
}

function combatReplayDraftFromEvent(event: CombatEventRow): CombatReplayDraft | null {
  if (
    event.eventType !== "battle_started" &&
    event.eventType !== "battle_round_resolved"
  ) {
    return null;
  }

  const row = payloadRecord(event.payload);
  if (row === null) return null;
  const systemId = stringField(row, "systemId");
  const attackerEmpireId = stringField(row, "attackerEmpireId");
  const defenderEmpireId = stringField(row, "defenderEmpireId");
  if (systemId === null || attackerEmpireId === null || defenderEmpireId === null) {
    return null;
  }

  const battleId =
    stringField(row, "battleId") ?? `${event.eventType}:${event._id}`;
  if (event.eventType === "battle_started") {
    const attackerShips = finiteCombatCount(row.attackerShips, 1);
    const defenderShips = finiteCombatCount(row.defenderShips, 1);
    return {
      battleId,
      systemId,
      attackerEmpireId,
      defenderEmpireId,
      attackerShipsAtStart: attackerShips,
      defenderShipsAtStart: defenderShips,
      attackerMotherships: finiteCombatCount(row.attackerMotherships, 0),
      defenderMotherships: finiteCombatCount(row.defenderMotherships, 0),
      latestRound: null,
    };
  }

  const latestRound = {
    turnNumber: event.turnNumber,
    roundNumber: finiteCombatCount(row.roundNumber, 0),
    attackerShipsBefore: finiteCombatCount(row.attackerShipsBefore, 1),
    defenderShipsBefore: finiteCombatCount(row.defenderShipsBefore, 1),
    attackerShipsAfter: finiteCombatCount(row.attackerShipsAfter, 0),
    defenderShipsAfter: finiteCombatCount(row.defenderShipsAfter, 0),
    mothershipEvents: mothershipReplayEvents(row.mothershipEvents),
  };
  return {
    battleId,
    systemId,
    attackerEmpireId,
    defenderEmpireId,
    attackerShipsAtStart: latestRound.attackerShipsBefore,
    defenderShipsAtStart: latestRound.defenderShipsBefore,
    attackerMotherships: 0,
    defenderMotherships: 0,
    latestRound,
  };
}

export type GalaxyViewportProps = {
  /** When set, map order context behaves as this empire (player home preview). */
  playerEmpireId?: Id<"emp_states"> | null;
  /** Fleet to select and center after navigating from another page. */
  initialFocusFleetId?: string | null;
  /** Rendered beside the star system panel below the map (player home layout). */
  starPanelAside?: ReactNode;
  /** Edge-to-edge map at 60vh with floating controls (player home). */
  playerHomeMapLayout?: boolean;
};

export function GalaxyViewport(props: GalaxyViewportProps = {}) {
  const {
    playerEmpireId: playerEmpireIdProp = null,
    initialFocusFleetId = null,
    starPanelAside,
    playerHomeMapLayout = false,
  } = props;
  const { activeGame, systems, links, empires, empireColors } = useGalaxyData();
  const galaxyMapNav = useGalaxyMapNav();
  const activeGameId = activeGame?._id ?? null;

  const simAllowsPlayerOrders = gameAllowsOrders(activeGame?.status);

  const fleetsQuery = useQuery(
    api.flt.queries.listFleetsForGame,
    activeGame ? { gameId: activeGame._id, limit: 256 } : "skip",
  );
  const fleets = useMemo(() => fleetsQuery ?? [], [fleetsQuery]);

  const pendingOrdersQuery = useQuery(
    api.flt.queries.listPendingMoveOrdersForTurn,
    simAllowsPlayerOrders && activeGame
      ? {
          gameId: activeGame._id,
          turnNumber: activeGame.currentTurn,
          limit: 256,
        }
      : "skip",
  );
  const pendingOrders = useMemo(() => pendingOrdersQuery ?? [], [pendingOrdersQuery]);

  const myRolesQuery = useQuery(
    api.usr.queries.listMyRoles,
    activeGame ? { gameId: activeGame._id } : "skip",
  );
  const myRoles = useMemo(() => myRolesQuery ?? [], [myRolesQuery]);

  const garrisonRoutesQuery = useQuery(
    api.flt.queries.listMyGarrisonRoutes,
    activeGame ? { gameId: activeGame._id } : "skip",
  );
  const garrisonRoutes = useMemo(() => garrisonRoutesQuery ?? [], [garrisonRoutesQuery]);

  const activeTradersQuery = useQuery(
    api.eco.queries.listActiveTraders,
    activeGame ? { gameId: activeGame._id } : "skip",
  );
  const activeTraders = useMemo(() => activeTradersQuery ?? [], [activeTradersQuery]);

  const colonyShipsQuery = useQuery(
    api.col.queries.listColonyShipsForGame,
    activeGame ? { gameId: activeGame._id, limit: 64 } : "skip",
  );
  const colonyShips = useMemo(() => colonyShipsQuery ?? [], [colonyShipsQuery]);

  const activeBattlesQuery = useQuery(
    api.cmb.queries.listActiveBattles,
    activeGame ? { gameId: activeGame._id, limit: 64 } : "skip",
  );
  const activeBattles = useMemo(() => activeBattlesQuery ?? [], [activeBattlesQuery]);
  const previousTurnCombatEventsQuery = useQuery(
    api.sim.queries.listEventsByTurn,
    activeGame && activeGame.currentTurn > 0
      ? {
          gameId: activeGame._id,
          turnNumber: activeGame.currentTurn - 1,
          limit: 256,
        }
      : "skip",
  );
  const previousTurnCombatEvents = useMemo(
    () => previousTurnCombatEventsQuery ?? [],
    [previousTurnCombatEventsQuery],
  );
  const recentSoundscapeEventsQuery = useQuery(
    api.sim.queries.listRecentEvents,
    activeGame ? { gameId: activeGame._id, limit: 24 } : "skip",
  );
  const recentSoundscapeEvents = useMemo(
    () => recentSoundscapeEventsQuery ?? [],
    [recentSoundscapeEventsQuery],
  );

  const turnTimelineQuery = useQuery(
    api.sim.queries.getTurnTimelineForGame,
    activeGame ? { gameId: activeGame._id } : "skip",
  );
  const gameSettingsQuery = useQuery(
    api.admin.mutations.getGameSettings,
    activeGame ? { gameId: activeGame._id } : "skip",
  );
  const turnTimeline = useMemo((): TurnTimelineModel | null => {
    if (turnTimelineQuery === undefined || turnTimelineQuery === null) return null;
    return {
      currentTurn: turnTimelineQuery.currentTurn,
      turnStartedAt: turnTimelineQuery.turnStartedAt,
      turnDurationMs: turnTimelineQuery.turnDurationMs,
    };
  }, [turnTimelineQuery]);

  const issueFleetOrder = useMutation(api.flt.mutations.issueFleetOrder);
  const setGarrisonRoute = useMutation(api.flt.mutations.setGarrisonRoute);
  const setEmphasis = useMutation(api.gal.mutations.setEmphasis);
  const adjustFoodImportSubsidy = useMutation(api.gal.mutations.adjustFoodImportSubsidy);
  const setPriorityStar = useMutation(api.gal.mutations.setPriorityStar);
  const startColonyShipBuild = useMutation(api.col.mutations.startColonyShipBuild);
  const cancelColonyShipBuild = useMutation(api.col.mutations.cancelColonyShipBuild);
  const dispatchColonyShip = useMutation(api.col.mutations.dispatchColonyShip);
  const colonizeWithColonyShip = useMutation(api.col.mutations.colonize);
  const resignFromGame = useMutation(api.usr.mutations.resignFromGame);
  const startGame = useMutation(api.sim.mutations.startGame);

  const [selectedFleetId, setSelectedFleetId] = useState<string | null>(null);
  const [selectedTraderId, setSelectedTraderId] = useState<string | null>(null);
  const [selectedColonyShipId, setSelectedColonyShipId] = useState<string | null>(null);
  const [selectedSystemId, setSelectedSystemId] = useState<string | null>(null);
  /** Local draft value for ships-effort slider (null = use server value). */
  const [localShipsPct, setLocalShipsPct] = useState<number | null>(null);
  const [emphasisCommitError, setEmphasisCommitError] = useState<string | null>(null);
  const [importSubsidyError, setImportSubsidyError] = useState<string | null>(null);
  const [priorityMutationError, setPriorityMutationError] = useState<string | null>(null);
  const [priorityStarOverrideState, setPriorityStarOverrideState] = useState<{
    gameId: string | null;
    empireId: string | null;
    overrides: Record<string, boolean>;
  }>({ gameId: null, empireId: null, overrides: {} });
  const [adminPriorityEmpireId, setAdminPriorityEmpireId] =
    useState<Id<"emp_states"> | null>(null);
  const [shipsToDispatch, setShipsToDispatch] = useState(1);
  const [repeatNextDragEnabled, setRepeatNextDragEnabled] = useState(false);
  const [routeEditorRouteId, setRouteEditorRouteId] = useState<string | null>(null);
  const [routeEditorPct, setRouteEditorPct] = useState(25);
  const [routeEditorEnabled, setRouteEditorEnabled] = useState(true);
  const [colonyMutationError, setColonyMutationError] = useState<string | null>(null);
  const [mapResignBusy, setMapResignBusy] = useState(false);
  const [mapResignError, setMapResignError] = useState<string | null>(null);
  const [startBusy, setStartBusy] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  const [camera, setCamera] = useState<GalaxyMapCamera>(() =>
    computeFitAllSystemsCamera([]),
  );
  // Tracks which axis the next "Fit galaxy" click will fill.
  // Wide screens default to horizontal-first; portrait/mobile default to vertical-first.
  const [nextFitAxis, setNextFitAxis] = useState<"h" | "v">(() =>
    typeof window !== "undefined" && window.innerWidth <= window.innerHeight ? "v" : "h",
  );
  const fittedGameRef = useRef<string | null>(null);
  const focusedInitialFleetRef = useRef<string | null>(null);
  const cameraRef = useRef(camera);
  const tweenRafRef = useRef<number | null>(null);

  useEffect(() => {
    cameraRef.current = camera;
  }, [camera]);

  useEffect(() => {
    startTransition(() => {
      setLocalShipsPct(null);
    });
  }, [selectedSystemId]);

  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const [viewSize, setViewSize] = useState<{ width: number; height: number }>({
    width: GALAXY_STAGE_WIDTH,
    height: GALAXY_STAGE_HEIGHT,
  });
  const viewSizeRef = useRef(viewSize);
  useEffect(() => {
    viewSizeRef.current = viewSize;
  }, [viewSize]);

  useLayoutEffect(() => {
    const el = mapContainerRef.current;
    if (el === null) return;
    const measure = () => {
      const w = Math.round(el.clientWidth);
      const h = Math.round(el.clientHeight);
      if (w <= 0 || h <= 0) return;
      setViewSize((prev) => (prev.width === w && prev.height === h ? prev : { width: w, height: h }));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [playerHomeMapLayout]);

  const cancelCameraTween = useCallback(() => {
    if (tweenRafRef.current !== null) {
      cancelAnimationFrame(tweenRafRef.current);
      tweenRafRef.current = null;
    }
  }, []);

  useEffect(() => () => cancelCameraTween(), [cancelCameraTween]);

  const handleCameraChange = useCallback(
    (next: GalaxyMapCamera) => {
      cancelCameraTween();
      setCamera({
        ...next,
        scale: clampMapScale(next.scale),
      });
    },
    [cancelCameraTween],
  );

  const startCameraTweenTo = useCallback(
    (target: GalaxyMapCamera) => {
      cancelCameraTween();
      const startSnapshot = cameraRef.current;
      const t0 = performance.now();

      const step = (now: number) => {
        const elapsed = now - t0;
        const t = Math.min(1, elapsed / MAP_CAMERA_TWEEN_MS);
        const k = easeOutCubic(t);
        const next: GalaxyMapCamera = {
          focusX: startSnapshot.focusX + (target.focusX - startSnapshot.focusX) * k,
          focusY: startSnapshot.focusY + (target.focusY - startSnapshot.focusY) * k,
          scale: clampMapScale(
            startSnapshot.scale + (target.scale - startSnapshot.scale) * k,
          ),
        };
        setCamera(next);
        if (t < 1) {
          tweenRafRef.current = requestAnimationFrame(step);
        } else {
          tweenRafRef.current = null;
        }
      };
      tweenRafRef.current = requestAnimationFrame(step);
    },
    [cancelCameraTween],
  );

  const empireNames = useMemo(
    () => Object.fromEntries(empires.map((e) => [e._id, e.name])),
    [empires],
  );

  const isAdmin = useMemo(() => myRoles.some((r) => r.role === "admin"), [myRoles]);

  const selectedSystem = useMemo(
    () => systems.find((s) => s._id === selectedSystemId) ?? null,
    [systems, selectedSystemId],
  );

  const selectedSystemRecentCombat = useQuery(
    api.cmb.queries.getMostRecentCombatForSystem,
    activeGame !== null && selectedSystem !== null
      ? {
          gameId: activeGame._id,
          systemId: selectedSystem._id,
        }
      : "skip",
  );

  const selectedSystemFleetSize = useMemo(() => {
    if (selectedSystem === null) return 0;
    return fleets
      .filter((fleet) => fleet.originSystemId === selectedSystem._id && fleet.status !== "enRoute")
      .reduce((sum, fleet) => sum + fleet.strength, 0);
  }, [fleets, selectedSystem]);

  const selectedSystemFleets = useMemo<FleetAtSystemInfo[]>(() => {
    if (selectedSystem === null) return [];
    return fleets
      .filter((fleet) => fleet.originSystemId === selectedSystem._id && fleet.status !== "enRoute")
      .map((fleet) => ({
        id: fleet._id,
        name: normalizeFleetDetachmentDisplayName(fleet.name),
        empireId: fleet.empireId,
        strength: fleet.strength,
        status: fleet.status,
      }))
      .sort((a, b) => b.strength - a.strength || a.name.localeCompare(b.name));
  }, [fleets, selectedSystem]);

  const selectedSystemColonyShips = useMemo<ColonyShipAtSystemInfo[]>(() => {
    if (selectedSystem === null) return [];
    return colonyShips
      .filter((ship) => ship.originSystemId === selectedSystem._id && ship.status === "idle")
      .map((ship) => ({
        id: ship._id,
        name: ship.name,
        empireId: ship.empireId,
        status: ship.status,
        mothershipDefenseDamage: ship.mothershipDefenseDamage,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [colonyShips, selectedSystem]);

  const selectedSystemDefenseAdvantage = useMemo(() => {
    const baseAdvantage = gameSettingsQuery?.combatDefenderAdvantage ?? 3;
    return (
      baseAdvantage *
      (selectedSystem?.isHomeworld === true ? HOMEWORLD_DEFENSE_ADVANTAGE_MULT : 1)
    );
  }, [gameSettingsQuery?.combatDefenderAdvantage, selectedSystem?.isHomeworld]);

  const canEditEmphasis = useMemo(() => {
    if (!simAllowsPlayerOrders || selectedSystem === null) return false;
    if (isAdmin) return true;
    if (selectedSystem.ownerEmpireId === null) return false;
    return myRoles.some(
      (r) =>
        r.role === "empire" &&
        r.empireId !== null &&
        r.empireId === selectedSystem.ownerEmpireId,
    );
  }, [simAllowsPlayerOrders, selectedSystem, isAdmin, myRoles]);

  const emphasisSliderHint = useMemo(() => {
    if (selectedSystem === null) return null;
    if (!simAllowsPlayerOrders) {
      return "Production sliders apply while the game is running or paused and accepting orders.";
    }
    if (isAdmin) return null;
    if (selectedSystem.ownerEmpireId === null) {
      return "No colony yet — only a game admin can preset sliders until this world is claimed.";
    }
    const empireRole = myRoles.find((r) => r.role === "empire");
    if (!empireRole?.empireId) {
      if (myRoles.some((r) => r.role === "trader")) {
        return "Trader accounts cannot change colony production.";
      }
      if (myRoles.some((r) => r.role === "observer")) {
        return "Observers cannot change colony production.";
      }
      return "Join this game with an empire seat to manage colony sliders.";
    }
    if (empireRole.empireId !== selectedSystem.ownerEmpireId) {
      const name = empireNames[selectedSystem.ownerEmpireId] ?? "another faction";
      return `This colony belongs to ${name}. Only they — or a game admin — can change sliders here.`;
    }
    return null;
  }, [selectedSystem, simAllowsPlayerOrders, isAdmin, myRoles, empireNames]);

  const myEmpireIdFromRole = useMemo(() => {
    const role = myRoles.find((r) => r.role === "empire");
    return role?.empireId ?? null;
  }, [myRoles]);
  const myEmpireId = playerEmpireIdProp ?? myEmpireIdFromRole;

  const fleetSelectionAllowed = useCallback(
    (fleetEmpireId: string) => {
      if (isAdmin) return true;
      return myEmpireId !== null && fleetEmpireId === myEmpireId;
    },
    [isAdmin, myEmpireId],
  );

  /** Player empire-only colony UI (production, food/fleet intel tabs). Admins with no empire seat still see full detail. */
  const showColonyOperationalIntel = useMemo(() => {
    if (selectedSystem === null) return true;
    if (myEmpireId === null) return true;
    return selectedSystem.ownerEmpireId === myEmpireId;
  }, [selectedSystem, myEmpireId]);

  const priorityEmpireOptions = useMemo(
    () => empires.filter((empire) => !empire.isCollapsed),
    [empires],
  );
  const activeAdminPriorityEmpireId =
    adminPriorityEmpireId !== null &&
    priorityEmpireOptions.some((empire) => empire._id === adminPriorityEmpireId)
      ? adminPriorityEmpireId
      : (priorityEmpireOptions[0]?._id ?? null);
  const priorityEmpireId =
    myEmpireId ??
    (playerEmpireIdProp === null && isAdmin && activeGameId !== null
      ? activeAdminPriorityEmpireId
      : null);
  const canUseColonyShips =
    simAllowsPlayerOrders && (isAdmin || myEmpireId !== null);
  const canMarkPriorityStars = simAllowsPlayerOrders && priorityEmpireId !== null;
  const myOwnedSystemsCount = useMemo(
    () =>
      myEmpireId === null
        ? 0
        : systems.filter((system) => system.ownerEmpireId === myEmpireId).length,
    [myEmpireId, systems],
  );
  const myFleetCount = useMemo(
    () =>
      myEmpireId === null ? 0 : fleets.filter((fleet) => fleet.empireId === myEmpireId).length,
    [fleets, myEmpireId],
  );
  const showMapResignButton =
    playerHomeMapLayout &&
    activeGame !== null &&
    activeGame.status !== "finished" &&
    myEmpireId !== null &&
    (myOwnedSystemsCount === 0 || myFleetCount === 0);
  const showPlayerStartOverlay =
    playerHomeMapLayout &&
    activeGame?.status === "lobby" &&
    myRoles.some((role) => role.role === "empire" && role.isActive);

  const handleMapResign = useCallback(async () => {
    if (activeGame === null) return;
    if (
      !window.confirm(
        "Resign from this game? If no human players remain, the game will end immediately, write final results, and begin cleanup.",
      )
    ) {
      return;
    }
    setMapResignBusy(true);
    setMapResignError(null);
    try {
      await resignFromGame({ gameId: activeGame._id });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setMapResignError(message.replace(/^[\s\S]*?Error:\s*/g, "").trim());
    } finally {
      setMapResignBusy(false);
    }
  }, [activeGame, resignFromGame]);

  const handlePlayerStartGame = useCallback(async () => {
    if (activeGame === null) return;
    setStartBusy(true);
    setStartError(null);
    try {
      await startGame({ gameId: activeGame._id });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStartError(message.replace(/^[\s\S]*?Error:\s*/g, "").trim());
    } finally {
      setStartBusy(false);
    }
  }, [activeGame, startGame]);

  const garrisonRouteEmpireFilter: Id<"emp_states"> | null =
    playerEmpireIdProp ?? (isAdmin ? null : myEmpireIdFromRole);
  const priorityStarsQuery = useQuery(
    api.gal.queries.listMyPriorityStars,
    activeGame !== null && priorityEmpireId !== null
      ? { gameId: activeGame._id, empireId: priorityEmpireId }
      : "skip",
  );
  const priorityStars = useMemo(() => priorityStarsQuery ?? [], [priorityStarsQuery]);
  const serverPriorityStarIds = useMemo(
    () => new Set(priorityStars.map((priorityStar) => priorityStar.systemId as string)),
    [priorityStars],
  );
  const priorityStarIds = useMemo(() => {
    const merged = new Set(serverPriorityStarIds);
    const overrides =
      priorityStarOverrideState.gameId === activeGameId &&
      priorityStarOverrideState.empireId === priorityEmpireId
        ? priorityStarOverrideState.overrides
        : {};
    for (const [systemId, enabled] of Object.entries(overrides)) {
      if (enabled) {
        merged.add(systemId);
      } else {
        merged.delete(systemId);
      }
    }
    return merged;
  }, [serverPriorityStarIds, priorityStarOverrideState, activeGameId, priorityEmpireId]);

  const togglePriorityStar = useCallback(
    async (systemId: Id<"gal_systems">, enabled: boolean) => {
      if (!activeGame || !canMarkPriorityStars || priorityEmpireId === null) return;
      setPriorityStarOverrideState((current) => {
        const overrides =
          current.gameId === activeGame._id && current.empireId === priorityEmpireId
            ? current.overrides
            : {};
        return {
          gameId: activeGame._id,
          empireId: priorityEmpireId,
          overrides: { ...overrides, [systemId]: enabled },
        };
      });
      setPriorityMutationError(null);
      try {
        await setPriorityStar({
          gameId: activeGame._id,
          systemId,
          empireId: priorityEmpireId,
          enabled,
        });
      } catch (e) {
        setPriorityStarOverrideState((current) => {
          const overrides =
            current.gameId === activeGame._id && current.empireId === priorityEmpireId
              ? current.overrides
              : {};
          return {
            gameId: activeGame._id,
            empireId: priorityEmpireId,
            overrides: { ...overrides, [systemId]: !enabled },
          };
        });
        setPriorityMutationError(
          e instanceof Error ? e.message : "Could not update Priority star.",
        );
      }
    },
    [activeGame, canMarkPriorityStars, priorityEmpireId, setPriorityStar],
  );

  useEffect(() => {
    if (selectedSystem === null || !canMarkPriorityStars) return;
    const selectedSystemIdForShortcut = selectedSystem._id;

    function onKeyDown(event: KeyboardEvent) {
      if (
        event.key.toLowerCase() !== "p" ||
        event.repeat ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        isEditableKeyboardTarget(event.target)
      ) {
        return;
      }

      event.preventDefault();
      void togglePriorityStar(
        selectedSystemIdForShortcut,
        !priorityStarIds.has(selectedSystemIdForShortcut),
      );
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedSystem, canMarkPriorityStars, priorityStarIds, togglePriorityStar]);

  const systemOwnerById = useMemo(
    () => Object.fromEntries(systems.map((s) => [s._id, s.ownerEmpireId])),
    [systems],
  );

  const validateColonyShipRouteForMap = useCallback(
    (routeSystemIds: string[]): string | null => {
      if (myEmpireId === null) return "You need an empire seat to plot colony routes.";
      return validateColonyShipRouteDestinations({
        routeSystemIds: routeSystemIds as Id<"gal_systems">[],
        empireId: myEmpireId,
        getOwner: (id) => systemOwnerById[id] ?? null,
      });
    },
    [myEmpireId, systemOwnerById],
  );

  const handleColonyShipRouteCommit = useCallback(
    async (payload: ColonyShipRouteCommitPayload) => {
      if (!activeGame) return;
      setColonyMutationError(null);
      try {
        await dispatchColonyShip({
          gameId: activeGame._id,
          colonyShipId: payload.colonyShipId as Id<"col_colony_ships">,
          routeSystemIds: payload.routeSystemIds as Id<"gal_systems">[],
        });
      } catch (e) {
        setColonyMutationError(
          e instanceof Error ? e.message : "Could not dispatch colony ship.",
        );
      }
    },
    [activeGame, dispatchColonyShip],
  );

  const priorityStarDisabledReason = useMemo(() => {
    if (!simAllowsPlayerOrders) {
      return "Priority stars can be changed while the game is running or paused.";
    }
    if (priorityEmpireId !== null) return null;
    if (isAdmin) return "Choose an empire before marking Priority stars.";
    if (myRoles.some((r) => r.role === "trader")) {
      return "Trader accounts cannot mark empire Priority stars.";
    }
    if (myRoles.some((r) => r.role === "observer")) {
      return "Observers cannot mark empire Priority stars.";
    }
    return "Join this game with an empire seat to mark Priority stars.";
  }, [simAllowsPlayerOrders, priorityEmpireId, isAdmin, myRoles]);

  const myIdleColonyShipsHere = useMemo(() => {
    if (selectedSystem === null || myEmpireId === null) return [];
    return colonyShips.filter(
      (s) =>
        s.status === "idle" &&
        s.originSystemId === selectedSystem._id &&
        s.empireId === myEmpireId,
    );
  }, [selectedSystem, myEmpireId, colonyShips]);

  const canColonizeHere =
    canUseColonyShips &&
    selectedSystem !== null &&
    selectedSystem.ownerEmpireId === null &&
    (selectedSystem.population ?? 0) < MIN_INHABITED_POPULATION &&
    myIdleColonyShipsHere.length > 0;

  const idleColonyShipIdAtSelection = myIdleColonyShipsHere[0]?._id ?? null;

  const handleStarPanelStartColonyBuild = useCallback(async () => {
    if (!activeGame || selectedSystem === null) return;
    setColonyMutationError(null);
    try {
      await startColonyShipBuild({
        gameId: activeGame._id,
        systemId: selectedSystem._id,
      });
    } catch (e) {
      setColonyMutationError(
        e instanceof Error ? e.message : "Could not start colony ship build.",
      );
    }
  }, [activeGame, selectedSystem, startColonyShipBuild]);

  const handleStarPanelCancelColonyBuild = useCallback(async () => {
    if (!activeGame || selectedSystem === null) return;
    setColonyMutationError(null);
    try {
      await cancelColonyShipBuild({
        gameId: activeGame._id,
        systemId: selectedSystem._id,
      });
    } catch (e) {
      setColonyMutationError(
        e instanceof Error ? e.message : "Could not cancel colony ship build.",
      );
    }
  }, [activeGame, selectedSystem, cancelColonyShipBuild]);

  const handleStarPanelDispatchColony = useCallback(
    async (toSystemId: string) => {
      if (!activeGame || selectedSystem === null) return;
      if (idleColonyShipIdAtSelection === null) return;
      setColonyMutationError(null);
      try {
        await dispatchColonyShip({
          gameId: activeGame._id,
          colonyShipId: idleColonyShipIdAtSelection,
          routeSystemIds: [toSystemId as Id<"gal_systems">],
        });
      } catch (e) {
        setColonyMutationError(
          e instanceof Error ? e.message : "Could not dispatch colony ship.",
        );
      }
    },
    [activeGame, selectedSystem, idleColonyShipIdAtSelection, dispatchColonyShip],
  );

  const handleStarPanelColonize = useCallback(async () => {
    if (!activeGame || idleColonyShipIdAtSelection === null) return;
    setColonyMutationError(null);
    try {
      await colonizeWithColonyShip({
        gameId: activeGame._id,
        colonyShipId: idleColonyShipIdAtSelection,
      });
    } catch (e) {
      setColonyMutationError(
        e instanceof Error ? e.message : "Could not colonize this system.",
      );
    }
  }, [activeGame, idleColonyShipIdAtSelection, colonizeWithColonyShip]);

  const dismissStarPanel = useCallback(() => {
    setSelectedSystemId(null);
    setLocalShipsPct(null);
    setEmphasisCommitError(null);
    setImportSubsidyError(null);
    setPriorityMutationError(null);
    setSelectedColonyShipId(null);
    setColonyMutationError(null);
  }, []);

  const dismissRouteEditor = useCallback(() => {
    setRouteEditorRouteId(null);
  }, []);

  const dismissTraderPanel = useCallback(() => {
    setSelectedTraderId(null);
  }, []);

  const handleTraderSelect = useCallback((traderId: string | null) => {
    setSelectedTraderId(traderId);
    if (traderId !== null) {
      setSelectedSystemId(null);
      setSelectedFleetId(null);
      setSelectedColonyShipId(null);
      setRouteEditorRouteId(null);
    }
  }, []);

  const handleSelectedColonyShipChange = useCallback((colonyShipId: string | null) => {
    setSelectedColonyShipId(colonyShipId);
    if (colonyShipId !== null) {
      setSelectedTraderId(null);
      setSelectedFleetId(null);
      setSelectedSystemId(null);
      setRouteEditorRouteId(null);
    }
  }, []);

  const handleSelectedFleetChange = useCallback(
    (fleetId: string | null) => {
      if (fleetId !== null) {
        const fleet = fleets.find((f) => f._id === fleetId);
        if (fleet !== undefined && !fleetSelectionAllowed(fleet.empireId)) {
          return;
        }
      }
      const isSameFleet = fleetId !== null && fleetId === selectedFleetId;
      setSelectedFleetId(fleetId);
      setSelectedTraderId(null);
      setSelectedColonyShipId(null);
      setSelectedSystemId(null);
      if (!isSameFleet) {
        setRepeatNextDragEnabled(false);
      }
      if (fleetId === null) return;
      if (isSameFleet) return;
      const fleet = fleets.find((f) => f._id === fleetId);
      if (fleet !== undefined) {
        const mid = Math.max(1, Math.floor(fleet.strength / 2));
        setShipsToDispatch(Math.min(mid, fleet.strength));
      }
    },
    [fleets, selectedFleetId, fleetSelectionAllowed],
  );

  const handleStageBackgroundTap = useCallback(() => {
    dismissStarPanel();
    handleSelectedFleetChange(null);
    dismissRouteEditor();
    dismissTraderPanel();
  }, [
    dismissStarPanel,
    dismissRouteEditor,
    dismissTraderPanel,
    handleSelectedFleetChange,
  ]);

  const handleRouteMidpointTap = useCallback(
    (routeId: string) => {
      const route = garrisonRoutes.find((r) => r._id === routeId);
      if (route === undefined) return;
      setRouteEditorRouteId(routeId);
      setRouteEditorPct(route.dispatchPct);
      setRouteEditorEnabled(route.enabled);
      setSelectedFleetId(null);
      setSelectedTraderId(null);
      setSelectedColonyShipId(null);
      setSelectedSystemId(null);
    },
    [garrisonRoutes],
  );

  const nodeMap = useMemo<Record<string, GalaxyNode>>(() => {
    return Object.fromEntries(
      systems.map((system) => [
        system._id,
        {
          id: system._id,
          x: system.x,
          y: system.y,
          ownerColor:
            system.ownerEmpireId !== null
              ? (empireColors[system.ownerEmpireId] ?? "#64748b")
              : "#64748b",
          isPriority: priorityStarIds.has(system._id),
        },
      ]),
    );
  }, [systems, empireColors, priorityStarIds]);

  const stageNodes = useMemo<GalaxyNode[]>(() => Object.values(nodeMap), [nodeMap]);
  const soundscapeSystemsById = useMemo(
    () => Object.fromEntries(systems.map((system) => [system._id, { x: system.x, y: system.y }])),
    [systems],
  );
  const soundscapeFleetEmpireById = useMemo(
    () => Object.fromEntries(fleets.map((fleet) => [fleet._id, fleet.empireId])),
    [fleets],
  );
  const soundscapeColonyShipEmpireById = useMemo(
    () => Object.fromEntries(colonyShips.map((ship) => [ship._id, ship.empireId])),
    [colonyShips],
  );
  const soundscapeSystemOwnerById = useMemo(
    () => Object.fromEntries(systems.map((system) => [system._id, system.ownerEmpireId])),
    [systems],
  );
  const {
    soundscapeEnabled,
    soundscapeStatus,
    soundscapeError,
    enableSoundscape,
    disableSoundscape,
  } = useGalaxySoundscape({
    activeGameId,
    camera: {
      ...camera,
      viewWidth: viewSize.width,
      viewHeight: viewSize.height,
    },
    recentEvents: recentSoundscapeEvents,
    systemsById: soundscapeSystemsById,
    ownership: {
      fleetEmpireById: soundscapeFleetEmpireById,
      colonyShipEmpireById: soundscapeColonyShipEmpireById,
      systemOwnerById: soundscapeSystemOwnerById,
    },
    listenerEmpireId: myEmpireId,
  });

  const focusEmpireHomeworld = useCallback(
    (empireId: Id<"emp_states">) => {
      const empire = empires.find((e) => e._id === empireId);
      if (empire === undefined) return;

      let systemId: string | null = empire.homeSystemId;
      if (systemId === null) {
        const homeworldSystem = systems.find(
          (s) => s.ownerEmpireId === empireId && s.isHomeworld,
        );
        systemId = homeworldSystem?._id ?? null;
      }
      if (systemId === null) {
        const anyOwned = systems.find((s) => s.ownerEmpireId === empireId);
        systemId = anyOwned?._id ?? null;
      }
      if (systemId === null) return;

      const node = nodeMap[systemId];
      if (node === undefined) return;

      setSelectedSystemId(systemId);
      setEmphasisCommitError(null);
      setImportSubsidyError(null);
      setPriorityMutationError(null);
      setSelectedFleetId(null);
      setSelectedTraderId(null);
      setSelectedColonyShipId(null);
      setRouteEditorRouteId(null);
      setColonyMutationError(null);

      const cur = cameraRef.current;
      const span = MAX_MAP_SCALE - MIN_MAP_SCALE;
      let nextScale = cur.scale;
      if (cur.scale <= MIN_MAP_SCALE + span * 0.22) {
        nextScale = clampMapScale(cur.scale * MAP_BUTTON_ZOOM_FACTOR);
      } else if (cur.scale >= MAX_MAP_SCALE - span * 0.22) {
        nextScale = clampMapScale(cur.scale / MAP_BUTTON_ZOOM_FACTOR);
      }

      startCameraTweenTo({
        focusX: node.x,
        focusY: node.y,
        scale: nextScale,
      });
    },
    [empires, systems, nodeMap, startCameraTweenTo],
  );

  useEffect(() => {
    if (galaxyMapNav === null) return;
    galaxyMapNav.setEmpireHomeworldFocusHandler(focusEmpireHomeworld);
    return () => {
      galaxyMapNav.setEmpireHomeworldFocusHandler(null);
    };
  }, [galaxyMapNav, focusEmpireHomeworld]);

  useEffect(() => {
    if (!activeGame) {
      fittedGameRef.current = null;
      return;
    }
    if (stageNodes.length === 0) return;
    if (fittedGameRef.current !== activeGame._id) {
      fittedGameRef.current = activeGame._id;
      cancelCameraTween();
      const { width, height } = viewSizeRef.current;
      setCamera(computeFitAllSystemsCamera(stageNodes, width, height));
    }
  }, [activeGame, stageNodes, cancelCameraTween]);

  const stageLinks = useMemo<GalaxyLink[]>(() => {
    return links
      .map((link) => ({
        fromId: link.fromSystemId,
        toId: link.toSystemId,
      }))
      .filter((link) => nodeMap[link.fromId] && nodeMap[link.toId]);
  }, [links, nodeMap]);

  const galaxyLinkRows = useMemo<GalaxyLinkRow[]>(() => {
    return links.map((link) => ({
      fromSystemId: link.fromSystemId,
      toSystemId: link.toSystemId,
    }));
  }, [links]);

  /**
   * Each click on a star pulses the camera one step closer to (centered-on-star, fully-zoomed),
   * with separate lerp fractions: centering snaps faster (so the star reaches the middle within
   * a click or two) while the zoom-in is a gentler series of pulses toward `MAX_MAP_SCALE`.
   */
  const handleStarTap = useCallback(
    (systemId: string) => {
      setSelectedSystemId(systemId);
      setEmphasisCommitError(null);
      setImportSubsidyError(null);
      setSelectedFleetId(null);
      setSelectedTraderId(null);
      setSelectedColonyShipId(null);
      setRouteEditorRouteId(null);
      setColonyMutationError(null);
      const node = nodeMap[systemId];
      if (node === undefined) return;
      const cur = cameraRef.current;
      startCameraTweenTo({
        focusX: cur.focusX + (node.x - cur.focusX) * STAR_CLICK_RECENTER_FRACTION,
        focusY: cur.focusY + (node.y - cur.focusY) * STAR_CLICK_RECENTER_FRACTION,
        scale: clampMapScale(
          cur.scale + (MAX_MAP_SCALE - cur.scale) * STAR_CLICK_ZOOM_FRACTION,
        ),
      });
    },
    [nodeMap, startCameraTweenTo],
  );

  const zoomFromCenter = useCallback(
    (factor: number) => {
      cancelCameraTween();
      setCamera((c) => ({
        ...c,
        scale: clampMapScale(c.scale * factor),
      }));
    },
    [cancelCameraTween],
  );

  const resetMapView = useCallback(() => {
    if (stageNodes.length === 0) return;
    cancelCameraTween();
    const { width, height } = viewSizeRef.current;
    if (nextFitAxis === "h") {
      setCamera(computeFitGalaxyHorizontal(stageNodes, width, height));
    } else {
      setCamera(computeFitGalaxyVertical(stageNodes, width, height));
    }
    setNextFitAxis((prev) => (prev === "h" ? "v" : "h"));
  }, [stageNodes, cancelCameraTween, nextFitAxis]);

  const fleetMarkers = useMemo<FleetMarkerModel[]>(() => {
    if (!simAllowsPlayerOrders) return [];
    const idle = fleets.filter((f) => f.status === "idle");
    const bySystem = new Map<string, typeof idle>();
    for (const fleet of idle) {
      const list = bySystem.get(fleet.originSystemId) ?? [];
      list.push(fleet);
      bySystem.set(fleet.originSystemId, list);
    }
    const markers: FleetMarkerModel[] = [];
    for (const [systemId, list] of bySystem) {
      list.sort((a, b) => a._id.localeCompare(b._id));
      const node = nodeMap[systemId];
      if (node === undefined) continue;
      const n = list.length;
      list.forEach((fleet, i) => {
        const angle = (i / n) * Math.PI * 2 - Math.PI / 2;
        markers.push({
          fleetId: fleet._id,
          empireId: fleet.empireId,
          originSystemId: systemId,
          x: node.x + Math.cos(angle) * FLEET_ORBIT_RADIUS,
          y: node.y + Math.sin(angle) * FLEET_ORBIT_RADIUS,
          colorHex: empireColors[fleet.empireId] ?? "#94a3b8",
        });
      });
    }
    return markers;
  }, [simAllowsPlayerOrders, fleets, nodeMap, empireColors]);

  const pendingSegments = useMemo<PendingSegmentModel[]>(() => {
    if (!simAllowsPlayerOrders) return [];
    const markerByFleetId = Object.fromEntries(
      fleetMarkers.map((m) => [m.fleetId, m]),
    );
    return pendingOrders.flatMap((order) => {
      const start = markerByFleetId[order.fleetId];
      const end = nodeMap[order.targetSystemId];
      if (start === undefined || end === undefined) return [];
      return [
        {
          key: order.orderId,
          originSystemId: start.originSystemId,
          targetSystemId: order.targetSystemId,
          x1: start.x,
          y1: start.y,
          x2: end.x,
          y2: end.y,
        },
      ];
    });
  }, [simAllowsPlayerOrders, fleetMarkers, pendingOrders, nodeMap]);

  const routeSegments = useMemo((): RouteSegmentModel[] => {
    if (!simAllowsPlayerOrders) return [];
    return garrisonRoutes.flatMap((route) => {
      if (garrisonRouteEmpireFilter !== null && route.empireId !== garrisonRouteEmpireFilter) {
        return [];
      }
      const from = nodeMap[route.originSystemId];
      const to = nodeMap[route.destinationSystemId];
      if (from === undefined || to === undefined) return [];
      return [
        {
          routeId: route._id,
          originSystemId: route.originSystemId,
          destSystemId: route.destinationSystemId,
          x1: from.x,
          y1: from.y,
          x2: to.x,
          y2: to.y,
          dispatchPct: route.dispatchPct,
          enabled: route.enabled,
          managedByStrategy: route.managedByStrategy === true,
        },
      ];
    });
  }, [simAllowsPlayerOrders, garrisonRoutes, nodeMap, garrisonRouteEmpireFilter]);

  const traderShips = useMemo((): TraderShipModel[] => {
    return activeTraders.map((t) => ({
      traderId: t._id,
      originSystemId: t.originSystemId,
      destSystemId: t.destinationSystemId,
      commodity: t.commodity,
      cargoUnits: t.cargoUnits,
      dispatchedTurn: t.dispatchedTurn,
      travelTurnsTotal: t.travelTurns,
      etaTurn: t.etaTurn,
      operatorKind:
        t.operatorKind === "player"
          ? "player"
          : t.operatorKind === "npc"
            ? "npc"
            : "unknown",
    }));
  }, [activeTraders]);

  const fleetEnRouteGhosts = useMemo<EnRouteGhostModel[]>(() => {
    if (!simAllowsPlayerOrders) return [];
    return fleets
      .filter(
        (f) =>
          f.status === "enRoute" &&
          f.destinationSystemId !== null &&
          f.etaTurn !== null &&
          f.dispatchedTurn !== undefined &&
          f.travelTurnsTotal !== undefined,
      )
      .map((f) => ({
        fleetId: f._id,
        originSystemId: f.originSystemId,
        destSystemId: f.destinationSystemId as string,
        strength: f.strength,
        colorHex: empireColors[f.empireId] ?? "#94a3b8",
        dispatchedTurn: f.dispatchedTurn as number,
        travelTurnsTotal: f.travelTurnsTotal as number,
        etaTurn: f.etaTurn as number,
      }));
  }, [simAllowsPlayerOrders, fleets, empireColors]);

  const colonyEnRouteGhosts = useMemo<EnRouteGhostModel[]>(() => {
    if (!simAllowsPlayerOrders) return [];
    return colonyShips
      .filter(
        (s) =>
          s.status === "enRoute" &&
          s.destinationSystemId !== null &&
          s.etaTurn !== null &&
          s.dispatchedTurn !== undefined &&
          s.travelTurnsTotal !== undefined,
      )
      .map((s) => ({
        fleetId: s._id,
        originSystemId: s.originSystemId,
        destSystemId: s.destinationSystemId as string,
        strength: 1,
        colorHex: empireColors[s.empireId] ?? "#5eead4",
        dispatchedTurn: s.dispatchedTurn as number,
        travelTurnsTotal: s.travelTurnsTotal as number,
        etaTurn: s.etaTurn as number,
        variant: "colony" as const,
      }));
  }, [simAllowsPlayerOrders, colonyShips, empireColors]);

  const enRouteGhosts = useMemo(
    () => [...fleetEnRouteGhosts, ...colonyEnRouteGhosts],
    [fleetEnRouteGhosts, colonyEnRouteGhosts],
  );

  const focusFleetOnMap = useCallback(
    (fleetId: string, scale = MAP_FLEET_FROM_PANEL_FOCUS_SCALE): boolean => {
      const marker = fleetMarkers.find((m) => m.fleetId === fleetId);
      if (marker !== undefined) {
        handleSelectedFleetChange(fleetId);
        startCameraTweenTo({
          focusX: marker.x,
          focusY: marker.y,
          scale,
        });
        return true;
      }

      const ghost = fleetEnRouteGhosts.find((g) => g.fleetId === fleetId);
      if (ghost !== undefined) {
        const from = nodeMap[ghost.originSystemId];
        const to = nodeMap[ghost.destSystemId];
        if (from === undefined || to === undefined) return false;
        const turnStartedAt = turnTimeline?.turnStartedAt ?? null;
        const turnDurationMs = Math.max(1, turnTimeline?.turnDurationMs ?? 1);
        const fraction = turnTravelProgress({
          now: Date.now(),
          currentTurn: turnTimeline?.currentTurn ?? activeGame?.currentTurn ?? ghost.dispatchedTurn,
          dispatchedTurn: ghost.dispatchedTurn,
          etaTurn: ghost.etaTurn,
          travelTurnsTotal: ghost.travelTurnsTotal,
          turnStartedAt,
          turnDurationMs,
        });
        handleSelectedFleetChange(fleetId);
        startCameraTweenTo({
          focusX: from.x + (to.x - from.x) * fraction,
          focusY: from.y + (to.y - from.y) * fraction,
          scale,
        });
        return true;
      }

      const fleet = fleets.find((f) => f._id === fleetId);
      const focus = fleet !== undefined ? nodeMap[fleet.originSystemId] : undefined;
      if (focus === undefined) return false;
      handleSelectedFleetChange(fleetId);
      startCameraTweenTo({
        focusX: focus.x,
        focusY: focus.y,
        scale,
      });
      return true;
    },
    [
      activeGame?.currentTurn,
      fleetEnRouteGhosts,
      fleetMarkers,
      fleets,
      handleSelectedFleetChange,
      nodeMap,
      startCameraTweenTo,
      turnTimeline,
    ],
  );

  const handleStarPanelFleetSelect = useCallback(
    (fleetId: string) => {
      focusFleetOnMap(fleetId);
    },
    [focusFleetOnMap],
  );

  useEffect(() => {
    if (initialFocusFleetId === null) {
      focusedInitialFleetRef.current = null;
      return;
    }
    if (focusedInitialFleetRef.current === initialFocusFleetId) return;
    const fleet = fleets.find((f) => f._id === initialFocusFleetId);
    if (fleet === undefined) return;
    if (!fleetSelectionAllowed(fleet.empireId)) return;
    const id = window.setTimeout(() => {
      if (focusFleetOnMap(initialFocusFleetId, MAP_FLEET_LINK_FOCUS_SCALE)) {
        focusedInitialFleetRef.current = initialFocusFleetId;
      }
    }, 0);
    return () => window.clearTimeout(id);
  }, [initialFocusFleetId, fleets, fleetSelectionAllowed, focusFleetOnMap]);

  const fleetById = useMemo(() => {
    return new Map(fleets.map((fleet) => [fleet._id, fleet]));
  }, [fleets]);

  const combatMarkers = useMemo<CombatMarkerModel[]>(() => {
    return activeBattles.map((battle) => {
      const attackerFleet = fleetById.get(battle.attackerFleetId);
      const defenderFleet = fleetById.get(battle.defenderFleetId);
      const attackerShips = finiteCombatCount(
        battle.attackerShips,
        attackerFleet?.strength ?? battle.attackerShipsAtStart ?? 1,
      );
      const defenderShips = finiteCombatCount(
        battle.defenderShips,
        defenderFleet?.strength ?? battle.defenderShipsAtStart ?? 1,
      );
      const attackerShipsAtStart = finiteCombatCount(
        battle.attackerShipsAtStart,
        attackerShips,
      );
      const defenderShipsAtStart = finiteCombatCount(
        battle.defenderShipsAtStart,
        defenderShips,
      );
      const latestRound = battle.latestRound ?? null;

      return {
        battleId: battle._id,
        systemId: battle.systemId,
        attackerFleetId: battle.attackerFleetId,
        defenderFleetId: battle.defenderFleetId,
        attackerColorHex: empireColors[battle.attackerEmpireId] ?? "#ef4444",
        defenderColorHex: empireColors[battle.defenderEmpireId] ?? "#60a5fa",
        attackerShips,
        defenderShips,
        attackerShipsAtStart,
        defenderShipsAtStart,
        attackerMotherships: finiteCombatCount(battle.attackerMotherships, 0),
        defenderMotherships: finiteCombatCount(battle.defenderMotherships, 0),
        phase: battle.phase,
        roundNumber: battle.roundNumber,
        latestRound:
          latestRound === null
            ? null
            : {
                turnNumber: finiteCombatCount(latestRound.turnNumber, activeGame?.currentTurn ?? 0),
                attackerShipsBefore: finiteCombatCount(
                  latestRound.attackerShipsBefore,
                  attackerShipsAtStart,
                ),
                defenderShipsBefore: finiteCombatCount(
                  latestRound.defenderShipsBefore,
                  defenderShipsAtStart,
                ),
                attackerShipsAfter: finiteCombatCount(
                  latestRound.attackerShipsAfter,
                  attackerShips,
                ),
                defenderShipsAfter: finiteCombatCount(
                  latestRound.defenderShipsAfter,
                  defenderShips,
                ),
                mothershipEvents: mothershipReplayEvents(latestRound.mothershipEvents),
              },
      };
    });
  }, [
    activeBattles,
    activeGame?.currentTurn,
    empireColors,
    fleetById,
  ]);

  const combatReplayMarkers = useMemo<CombatMarkerModel[]>(() => {
    const activeBattleIds = new Set(combatMarkers.map((marker) => marker.battleId));
    const drafts = new Map<string, CombatReplayDraft>();

    for (const event of previousTurnCombatEvents) {
      const draft = combatReplayDraftFromEvent(event);
      if (draft === null || activeBattleIds.has(draft.battleId)) continue;
      const existing = drafts.get(draft.battleId);
      if (existing === undefined) {
        drafts.set(draft.battleId, draft);
        continue;
      }
      drafts.set(draft.battleId, {
        ...existing,
        attackerShipsAtStart: Math.max(
          existing.attackerShipsAtStart,
          draft.attackerShipsAtStart,
        ),
        defenderShipsAtStart: Math.max(
          existing.defenderShipsAtStart,
          draft.defenderShipsAtStart,
        ),
        attackerMotherships: Math.max(
          existing.attackerMotherships,
          draft.attackerMotherships,
        ),
        defenderMotherships: Math.max(
          existing.defenderMotherships,
          draft.defenderMotherships,
        ),
        latestRound:
          draft.latestRound !== null &&
          (existing.latestRound === null ||
            draft.latestRound.roundNumber >= existing.latestRound.roundNumber)
            ? draft.latestRound
            : existing.latestRound,
      });
    }

    return [...drafts.values()].map((draft) => {
      const latestRound = draft.latestRound;
      return {
        battleId: draft.battleId,
        systemId: draft.systemId,
        attackerFleetId: draft.battleId,
        defenderFleetId: draft.battleId,
        attackerColorHex: empireColors[draft.attackerEmpireId] ?? "#ef4444",
        defenderColorHex: empireColors[draft.defenderEmpireId] ?? "#60a5fa",
        attackerShips: latestRound?.attackerShipsAfter ?? draft.attackerShipsAtStart,
        defenderShips: latestRound?.defenderShipsAfter ?? draft.defenderShipsAtStart,
        attackerShipsAtStart: draft.attackerShipsAtStart,
        defenderShipsAtStart: draft.defenderShipsAtStart,
        attackerMotherships: draft.attackerMotherships,
        defenderMotherships: draft.defenderMotherships,
        phase: "awaitingAttackerDecision",
        roundNumber: latestRound?.roundNumber ?? 0,
        latestRound,
      };
    });
  }, [combatMarkers, empireColors, previousTurnCombatEvents]);

  const visibleCombatMarkers = useMemo(
    () => [...combatMarkers, ...combatReplayMarkers],
    [combatMarkers, combatReplayMarkers],
  );

  const colonyShipMarkers = useMemo<ColonyShipMarkerModel[]>(() => {
    if (!simAllowsPlayerOrders) return [];
    const idle = colonyShips.filter((s) => s.status === "idle");
    const bySystem = new Map<string, typeof idle>();
    for (const ship of idle) {
      const list = bySystem.get(ship.originSystemId) ?? [];
      list.push(ship);
      bySystem.set(ship.originSystemId, list);
    }
    const markers: ColonyShipMarkerModel[] = [];
    for (const [systemId, list] of bySystem) {
      list.sort((a, b) => a._id.localeCompare(b._id));
      const node = nodeMap[systemId];
      if (node === undefined) continue;
      const n = list.length;
      list.forEach((ship, i) => {
        const angle =
          (i / n) * Math.PI * 2 - Math.PI / 2 + COLONY_ORBIT_ANGLE_OFFSET_RAD;
        const ownerAtOrigin = systemOwnerById[ship.originSystemId] ?? null;
        const canDragDispatchRoute =
          myEmpireId !== null &&
          ship.empireId === myEmpireId &&
          ownerAtOrigin === ship.empireId;
        markers.push({
          colonyShipId: ship._id,
          originSystemId: systemId,
          x: node.x + Math.cos(angle) * COLONY_ORBIT_RADIUS,
          y: node.y + Math.sin(angle) * COLONY_ORBIT_RADIUS,
          colorHex: empireColors[ship.empireId] ?? "#2dd4bf",
          canDragDispatchRoute,
        });
      });
    }
    return markers;
  }, [simAllowsPlayerOrders, colonyShips, nodeMap, empireColors, myEmpireId, systemOwnerById]);

  const foodAlerts = useMemo<FoodAlertNode[]>(() => {
    const alerts: FoodAlertNode[] = [];
    for (const s of systems) {
      const pop = s.population ?? 0;
      if (pop <= 0 || s.ownerEmpireId === null) continue;
      const f = s.emphasisFood ?? 34;
      const sh = s.emphasisShips ?? 33;
      const r = s.emphasisResearch ?? 33;
      const p = previewColonyFoodFlows({
        populationPeople: pop,
        resourceRichness: s.resourceRichness,
        baseProductivity: s.baseProductivity,
        emphasisFood: f,
        emphasisShips: sh,
        emphasisResearch: r,
        isHomeworld: s.isHomeworld,
        recentDamagePopulation: s.recentDamagePopulation,
      });
      const netPerTurn = p.netTotal;
      const stockFood = s.stockFood ?? 0;
      const turnsLeft = netPerTurn >= 0 ? Infinity : stockFood / Math.abs(netPerTurn);
      if (turnsLeft < 4) {
        const severity = Math.max(0, Math.min(1, 1 - turnsLeft / 4));
        alerts.push({ id: s._id, severity });
      }
    }
    return alerts;
  }, [systems]);

  const starvationAlerts = useMemo<StarvationNode[]>(() => {
    return systems
      .filter((s) => {
        const pop = s.population ?? 0;
        if (pop <= 0 || s.ownerEmpireId === null) return false;
        const stockFood = s.stockFood ?? 0;
        const f = s.emphasisFood ?? 34;
        const sh = s.emphasisShips ?? 33;
        const r = s.emphasisResearch ?? 33;
        const p = previewColonyFoodFlows({
          populationPeople: pop,
          resourceRichness: s.resourceRichness,
          baseProductivity: s.baseProductivity,
          emphasisFood: f,
          emphasisShips: sh,
          emphasisResearch: r,
          isHomeworld: s.isHomeworld,
          recentDamagePopulation: s.recentDamagePopulation,
        });
        return stockFood <= 0 && p.effectiveProdTotal < p.demandTotal;
      })
      .map((s) => ({ id: s._id }));
  }, [systems]);

  const selectedFleet = useMemo(() => {
    if (selectedFleetId === null) return undefined;
    const fleet = fleets.find((f) => f._id === selectedFleetId);
    return fleet !== undefined && fleetSelectionAllowed(fleet.empireId)
      ? fleet
      : undefined;
  }, [fleets, selectedFleetId, fleetSelectionAllowed]);

  const selectedTrader = useMemo(() => {
    if (selectedTraderId === null) return undefined;
    return activeTraders.find((t) => t._id === selectedTraderId);
  }, [activeTraders, selectedTraderId]);

  const selectedColonyShip = useMemo(() => {
    if (selectedColonyShipId === null) return undefined;
    return colonyShips.find((s) => s._id === selectedColonyShipId);
  }, [colonyShips, selectedColonyShipId]);

  const selectedNeighbors = useMemo(() => {
    if (selectedSystem === null) return [];
    const nameById = Object.fromEntries(systems.map((s) => [s._id, s.name]));
    const ids = new Set<string>();
    for (const link of links) {
      if (link.fromSystemId === selectedSystem._id) ids.add(link.toSystemId);
      if (link.toSystemId === selectedSystem._id) ids.add(link.fromSystemId);
    }
    return [...ids]
      .map((id) => ({ id, name: nameById[id] ?? id }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [selectedSystem, links, systems]);

  const cappedShipsToDispatch =
    selectedFleet !== undefined
      ? Math.min(Math.max(shipsToDispatch, 0), selectedFleet.strength)
      : shipsToDispatch;

  const onFleetMoveCommit = useCallback(
    async (payload: {
      fleetId: string;
      targetSystemId: string;
      shipCount: number;
      originSystemId: string;
      establishRecurring: boolean;
    }) => {
      if (!activeGame || !simAllowsPlayerOrders) return;
      const fleet = fleets.find((f) => f._id === payload.fleetId);
      if (fleet === undefined || !fleetSelectionAllowed(fleet.empireId)) return;
      const strength = fleet.strength;
      const originSystem = systems.find((s) => s._id === payload.originSystemId);
      const canEstablishRecurring =
        payload.establishRecurring &&
        originSystem?.ownerEmpireId !== null &&
        originSystem?.ownerEmpireId !== undefined;
      const standingRouteDispatchPct = canEstablishRecurring
        ? Math.max(
            1,
            Math.min(100, Math.round((payload.shipCount / Math.max(1, strength)) * 100)),
          )
        : undefined;
      await issueFleetOrder({
        gameId: activeGame._id,
        fleetId: payload.fleetId as Id<"flt_fleets">,
        orderType: "move",
        targetSystemId: payload.targetSystemId as Id<"gal_systems">,
        ...(strength > payload.shipCount ? { shipCount: payload.shipCount } : {}),
        ...(standingRouteDispatchPct !== undefined ? { standingRouteDispatchPct } : {}),
      });
    },
    [activeGame, simAllowsPlayerOrders, issueFleetOrder, fleets, systems, fleetSelectionAllowed],
  );

  const editingRoute = useMemo(
    () =>
      routeEditorRouteId === null
        ? null
        : garrisonRoutes.find((r) => r._id === routeEditorRouteId) ?? null,
    [routeEditorRouteId, garrisonRoutes],
  );

  const showRouteEditor =
    editingRoute !== null &&
    simAllowsPlayerOrders &&
    (isAdmin || editingRoute.empireId === myEmpireId);

  async function saveRouteEditor() {
    if (!activeGame || editingRoute === null) return;
    await setGarrisonRoute({
      gameId: activeGame._id,
      originSystemId: editingRoute.originSystemId,
      destinationSystemId: editingRoute.destinationSystemId,
      dispatchPct: routeEditorPct,
      enabled: routeEditorEnabled,
    });
  }

  async function clearRouteEditor() {
    if (!activeGame || editingRoute === null) return;
    await setGarrisonRoute({
      gameId: activeGame._id,
      originSystemId: editingRoute.originSystemId,
      destinationSystemId: null,
      dispatchPct: 0,
      enabled: false,
    });
    dismissRouteEditor();
  }

  const showFleetPanel =
    simAllowsPlayerOrders &&
    selectedFleet !== undefined &&
    selectedFleet.status === "idle" &&
    selectedColonyShipId === null;

  const showColonyShipPanel =
    simAllowsPlayerOrders &&
    selectedColonyShip !== undefined &&
    activeGame !== null;

  const showTraderPanel = activeGame !== null && selectedTrader !== undefined;

  const fleetPanelInner =
    showFleetPanel && selectedFleet !== undefined ? (
      <>
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="font-medium text-st-fg">
              {normalizeFleetDetachmentDisplayName(selectedFleet.name)}
            </div>
            <div className="mt-0.5 text-xs text-st-muted">
              {selectedFleet.strength}{" "}
              {selectedFleet.strength === 1 ? "ship" : "ships"} at system
            </div>
          </div>
          <button
            type="button"
            className="shrink-0 text-xs text-st-muted underline hover:text-st-fg"
            onClick={() => handleSelectedFleetChange(null)}
          >
            Clear
          </button>
        </div>
        <label className="mt-3 block text-xs text-st-muted">
          Ships to send on drag-drop move
          <div className="mt-1 flex items-center gap-2">
            <input
              type="range"
              min={0}
              max={selectedFleet.strength}
              value={cappedShipsToDispatch}
              onChange={(e) => setShipsToDispatch(Number(e.target.value))}
              className="min-w-0 flex-1 accent-cyan-400"
            />
            <button
              type="button"
              title={
                repeatNextDragEnabled
                  ? "Recurring route on — drop sets automatic sends each turn"
                  : "Turn on to save this hop as a recurring route when you drop"
              }
              aria-label="Toggle recurring route on drag-drop"
              aria-pressed={repeatNextDragEnabled}
              disabled={cappedShipsToDispatch < 1}
              onClick={() => setRepeatNextDragEnabled((v) => !v)}
              className={`flex size-9 shrink-0 items-center justify-center rounded-md border transition-colors ${
                repeatNextDragEnabled
                  ? "border-violet-400 bg-violet-500/20 text-violet-200"
                  : "border-st-border bg-st-panel text-st-muted hover:border-st-accent hover:text-st-fg"
              } disabled:cursor-not-allowed disabled:opacity-40`}
            >
              <Repeat2 className="size-4" aria-hidden />
            </button>
          </div>
          <div className="mt-1 font-mono text-xs text-st-fg">
            {cappedShipsToDispatch} of {selectedFleet.strength}
            {repeatNextDragEnabled && cappedShipsToDispatch >= 1 ? (
              <span className="ml-2 text-violet-300">
                (
                {Math.max(
                  1,
                  Math.min(
                    100,
                    Math.round(
                      (cappedShipsToDispatch / Math.max(1, selectedFleet.strength)) * 100,
                    ),
                  ),
                )}
                % recurring)
              </span>
            ) : null}
          </div>
        </label>
        {repeatNextDragEnabled && cappedShipsToDispatch >= 1 ? (
          <p className="mt-2 text-xs text-violet-300/90">
            Drop on a linked star to issue this move and save that hop as a{" "}
            <strong className="text-violet-200">standing route</strong> (
            {Math.max(
              1,
              Math.min(
                100,
                Math.round(
                  (cappedShipsToDispatch / Math.max(1, selectedFleet.strength)) * 100,
                ),
              ),
            )}
            % of idle garrison each turn). Tap a dashed line to edit (violet = yours, grey-violet =
            automation).
          </p>
        ) : null}
        {cappedShipsToDispatch < 1 ? (
          <p className="mt-2 text-xs text-amber-400/90">
            Set at least 1 ship to drag this fleet to a linked star.
          </p>
        ) : null}
      </>
    ) : null;

  function renderSelectedStarSystemPanelOnly(): ReactNode {
    if (selectedSystem === null) return null;
    return (
        <StarSystemPanel
          key={`${selectedSystem._id}:${showColonyOperationalIntel ? "food" : "routes"}`}
          system={selectedSystem}
          empireNames={empireNames}
          selectedNeighbors={selectedNeighbors}
          showColonyOperationalIntel={showColonyOperationalIntel}
          fleetSelectionAllowed={fleetSelectionAllowed}
          canEdit={canEditEmphasis}
          emphasisHint={emphasisSliderHint}
          emphasisSaveError={emphasisCommitError}
          importSubsidyError={importSubsidyError}
          priorityMutationError={priorityMutationError}
          isPriorityStar={priorityStarIds.has(selectedSystem._id)}
          canMarkPriorityStar={canMarkPriorityStars}
          priorityDisabledReason={priorityStarDisabledReason}
          priorityEmpireId={priorityEmpireId}
          priorityEmpireOptions={priorityEmpireOptions}
          canChoosePriorityEmpire={
            isAdmin && myEmpireIdFromRole === null && playerEmpireIdProp === null
          }
          onPriorityEmpireChange={(empireId) => {
            setAdminPriorityEmpireId(empireId);
            setPriorityMutationError(null);
          }}
          localShipsPct={localShipsPct}
          onLocalShipsPctChange={setLocalShipsPct}
          onShipsPctCommit={async (pct) => {
            if (!activeGame || !canEditEmphasis) return;
            setEmphasisCommitError(null);
            try {
              await setEmphasis({
                gameId: activeGame._id,
                systemId: selectedSystem._id,
                emphasisShips: pct,
              });
            } catch (e) {
              setEmphasisCommitError(
                e instanceof Error ? e.message : "Could not save production mix.",
              );
            }
          }}
          onImportSubsidyDelta={async (delta) => {
            if (!activeGame || !canEditEmphasis) return;
            setImportSubsidyError(null);
            try {
              await adjustFoodImportSubsidy({
                gameId: activeGame._id,
                systemId: selectedSystem._id,
                delta,
              });
            } catch (e) {
              setImportSubsidyError(
                e instanceof Error ? e.message : "Could not update import offer.",
              );
            }
          }}
          onPriorityStarToggle={(enabled) => togglePriorityStar(selectedSystem._id, enabled)}
          onNeighborNavigate={handleStarTap}
          onClose={dismissStarPanel}
          foodStockpileMinPerPop={gameSettingsQuery?.foodStockpileMinPerPop ?? 2.0}
          foodStockpileMaxPerPop={gameSettingsQuery?.foodStockpileMaxPerPop ?? 20.0}
          foodStressFactor={gameSettingsQuery?.foodStressFactor ?? 1}
          dockingFee={gameSettingsQuery?.traderDockingCost ?? DEFAULT_TRADER_DOCKING_COST}
          fleetSize={selectedSystemFleetSize}
          fleetsAtSystem={selectedSystemFleets}
          colonyShipsAtSystem={selectedSystemColonyShips}
          defenseAdvantage={selectedSystemDefenseAdvantage}
          recentCombat={selectedSystemRecentCombat}
          canUseColonyShips={canUseColonyShips}
          canColonizeAtStar={canColonizeHere}
          colonizeShipId={idleColonyShipIdAtSelection}
          idleColonyShipIdForNeighborDispatch={idleColonyShipIdAtSelection}
          colonyMutationError={colonyMutationError}
          gameIdForColony={activeGame?._id ?? null}
          onStartColonyBuild={handleStarPanelStartColonyBuild}
          onCancelColonyBuild={handleStarPanelCancelColonyBuild}
          onDispatchColonyFromStarPanel={handleStarPanelDispatchColony}
        onColonizeFromStarPanel={handleStarPanelColonize}
        onFleetCardTap={handleStarPanelFleetSelect}
      />
    );
  }

  function renderStarSystemPanelArea() {
    const star = renderSelectedStarSystemPanelOnly();
    return star !== null ? star : <PlanetInfoEmptyPanel />;
  }

  const lowerPanels =
    activeGame !== null
      ? playerHomeMapLayout && starPanelAside != null
        ? null
        : starPanelAside != null
          ? (
              <div className="grid gap-4 lg:grid-cols-[1fr_360px] lg:items-start">
                <div>{renderStarSystemPanelArea()}</div>
                {starPanelAside}
              </div>
            )
          : (
              renderStarSystemPanelArea()
            )
      : null;

  const mapControlBtnClass = playerHomeMapLayout
    ? "size-8 shrink-0 border-st-border/80 bg-st-bg/95 p-0 shadow-md ring-1 ring-st-border/50 backdrop-blur-sm"
    : "size-8 shrink-0 p-0";

  const mapZoomControlButtons =
    activeGame !== null ? (
      <div className="flex items-center gap-1">
        <Button
          variant="secondary"
          className={mapControlBtnClass}
          title={soundscapeEnabled ? "Disable event bell soundscape" : "Enable event bell soundscape"}
          aria-label={soundscapeEnabled ? "Disable event bell soundscape" : "Enable event bell soundscape"}
          type="button"
          onClick={() => {
            if (soundscapeEnabled || soundscapeStatus === "starting") {
              disableSoundscape();
              return;
            }
            void enableSoundscape();
          }}
        >
          {soundscapeEnabled ? <Volume2 className="size-4" aria-hidden /> : <VolumeX className="size-4" aria-hidden />}
        </Button>
        <Button
          variant="secondary"
          className={mapControlBtnClass}
          title="Zoom out"
          aria-label="Zoom out"
          type="button"
          onClick={() => zoomFromCenter(1 / MAP_BUTTON_ZOOM_FACTOR)}
        >
          <Minus className="size-4" aria-hidden />
        </Button>
        <Button
          variant="secondary"
          className={mapControlBtnClass}
          title="Zoom in"
          aria-label="Zoom in"
          type="button"
          onClick={() => zoomFromCenter(MAP_BUTTON_ZOOM_FACTOR)}
        >
          <Plus className="size-4" aria-hidden />
        </Button>
        <Button
          variant="secondary"
          className={mapControlBtnClass}
          title={nextFitAxis === "h" ? "Fit galaxy width" : "Fit galaxy height"}
          aria-label={nextFitAxis === "h" ? "Fit galaxy width" : "Fit galaxy height"}
          type="button"
          onClick={resetMapView}
        >
          <Expand className="size-4" aria-hidden />
        </Button>
        {soundscapeError !== null ? (
          <div className="pointer-events-auto max-w-44 rounded-md border border-red-500/40 bg-st-panel/95 px-2 py-1 text-[11px] text-red-200 shadow-lg">
            {soundscapeError}
          </div>
        ) : soundscapeStatus === "starting" ? (
          <div className="pointer-events-none rounded-md border border-st-border/70 bg-st-panel/90 px-2 py-1 text-[11px] text-st-muted shadow-lg">
            Starting sound…
          </div>
        ) : null}
      </div>
    ) : null;

  const galaxyStageEl = (
    <GalaxyStage
      viewWidth={viewSize.width}
      viewHeight={viewSize.height}
      camera={camera}
      onCameraChange={handleCameraChange}
      nodes={stageNodes}
      links={stageLinks}
      galaxyLinks={galaxyLinkRows}
      fleetMarkers={fleetMarkers}
      colonyShipMarkers={colonyShipMarkers}
      pendingSegments={pendingSegments}
      routeSegments={routeSegments}
      enRouteGhosts={enRouteGhosts}
      traderShips={traderShips}
      combatMarkers={visibleCombatMarkers}
      turnTimeline={turnTimeline}
      selectedFleetId={selectedFleet?._id ?? null}
      onSelectedFleetChange={handleSelectedFleetChange}
      selectedTraderId={selectedTraderId}
      onSelectedTraderChange={handleTraderSelect}
      selectedSystemId={selectedSystemId}
      selectedColonyShipId={selectedColonyShipId}
      onSelectedColonyShipChange={handleSelectedColonyShipChange}
      shipsToDispatch={cappedShipsToDispatch}
      repeatNextDragEnabled={repeatNextDragEnabled}
      foodAlerts={foodAlerts}
      starvationAlerts={starvationAlerts}
      canIssueOrders={simAllowsPlayerOrders}
      fleetSelectionAllowed={fleetSelectionAllowed}
      onFleetMoveCommit={simAllowsPlayerOrders ? onFleetMoveCommit : undefined}
      onRouteMidpointTap={
        simAllowsPlayerOrders && routeSegments.length > 0
          ? handleRouteMidpointTap
          : undefined
      }
      onStarPointerTap={activeGame ? handleStarTap : undefined}
      onStarDoubleTap={activeGame ? handleStarTap : undefined}
      onStageBackgroundTap={activeGame ? handleStageBackgroundTap : undefined}
      onColonyShipRouteCommit={
        simAllowsPlayerOrders && activeGame ? handleColonyShipRouteCommit : undefined
      }
      validateColonyShipRoute={validateColonyShipRouteForMap}
    />
  );

  return (
    <section
      className={
        playerHomeMapLayout
          ? "relative flex min-h-0 min-w-0 flex-1 flex-col"
          : "relative overflow-hidden rounded-xl border border-st-border bg-st-panel p-2"
      }
    >
      {playerHomeMapLayout ? (
        <div className="relative left-1/2 flex min-h-0 w-screen max-w-[100vw] flex-1 -translate-x-1/2 flex-col border-b border-st-border bg-st-panel">
          <div
            className={
              starPanelAside != null
                ? "flex min-h-0 min-w-0 flex-1"
                : "relative min-h-0 flex-1 overflow-hidden"
            }
          >
            <div
              ref={mapContainerRef}
              className={
                starPanelAside != null
                  ? "relative min-h-0 min-w-0 flex-1 overflow-hidden"
                  : "relative h-full min-h-0 w-full overflow-hidden"
              }
            >
              {galaxyStageEl}
              <div className="pointer-events-none absolute inset-0 z-[6]">
                {showPlayerStartOverlay ? (
                  <div className="pointer-events-auto absolute left-1/2 top-1/2 flex w-[min(92vw,28rem)] -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-3 rounded-2xl border border-st-border bg-st-bg/95 px-6 py-6 text-center shadow-2xl backdrop-blur-sm">
                    <h2 className="text-xl font-semibold text-st-fg">Ready to begin?</h2>
                    <p className="text-sm text-st-muted">
                      Start the match to open turn 1 and begin empire play for this scenario.
                    </p>
                    <Button
                      type="button"
                      className="w-full max-w-xs py-3 text-base"
                      disabled={startBusy}
                      onClick={() => {
                        void handlePlayerStartGame();
                      }}
                    >
                      {startBusy ? "Starting..." : "Start game"}
                    </Button>
                    {startError !== null ? (
                      <p className="text-xs text-red-300" role="alert">
                        {startError}
                      </p>
                    ) : null}
                  </div>
                ) : null}
                {mapZoomControlButtons !== null ? (
                  <div className="pointer-events-auto absolute right-3 top-3">
                    {mapZoomControlButtons}
                  </div>
                ) : null}
                {showMapResignButton ? (
                  <div className="pointer-events-auto absolute left-1/2 top-3 flex -translate-x-1/2 flex-col items-center gap-1">
                    <Button
                      type="button"
                      variant="secondary"
                      className="border border-orange-500/40 bg-st-bg/95 text-orange-700 shadow-md ring-1 ring-st-border/50 backdrop-blur-sm hover:border-orange-500/70 hover:text-orange-800 dark:text-orange-300 dark:hover:text-orange-200"
                      disabled={mapResignBusy}
                      onClick={() => {
                        void handleMapResign();
                      }}
                    >
                      {mapResignBusy ? "Resigning..." : "Resign"}
                    </Button>
                    {mapResignError !== null ? (
                      <p className="max-w-64 rounded bg-red-950/85 px-2 py-1 text-center text-[11px] text-red-200 shadow-md">
                        {mapResignError}
                      </p>
                    ) : null}
                  </div>
                ) : null}
                <div className="absolute bottom-3 right-3 rounded-md bg-st-bg/90 px-2.5 py-1 text-xs text-st-muted shadow-md ring-1 ring-st-border/70 backdrop-blur-sm">
                  {activeGame ? `${stageNodes.length} stars` : "Create + seed a game"}
                </div>
              </div>
            </div>
            {starPanelAside != null ? (
              <aside className="flex w-[360px] shrink-0 flex-col border-l border-st-border bg-st-panel">
                <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain p-2">
                  {fleetPanelInner !== null ? (
                    <div className="pointer-events-auto rounded-lg border border-st-border bg-st-bg/95 p-3 text-sm shadow-sm">
                      {fleetPanelInner}
                    </div>
                  ) : (
                    (() => {
                      const starOnly = renderSelectedStarSystemPanelOnly();
                      if (starOnly !== null) {
                        return <div className="min-w-0">{starOnly}</div>;
                      }
                      return starPanelAside;
                    })()
                  )}
                </div>
              </aside>
            ) : null}
          </div>
        </div>
      ) : (
        <>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2 px-2">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-st-muted">
              Galaxy Map
            </h2>
            <div className="flex flex-wrap items-center justify-end gap-2">
              {mapZoomControlButtons}
              <span className="text-xs text-st-muted">
                {activeGame ? `${stageNodes.length} systems` : "Create + seed a game"}
              </span>
            </div>
          </div>
          <div
            ref={mapContainerRef}
            className="relative w-full overflow-hidden rounded-lg"
            style={{ aspectRatio: `${GALAXY_STAGE_WIDTH} / ${GALAXY_STAGE_HEIGHT}` }}
          >
            {galaxyStageEl}
          </div>
        </>
      )}
      {playerHomeMapLayout && lowerPanels !== null ? (
        <div className="mx-auto mt-4 max-w-7xl px-4 sm:px-6">{lowerPanels}</div>
      ) : (
        lowerPanels
      )}
      {showTraderPanel && selectedTrader !== undefined && activeGame ? (
        <div className="pointer-events-auto absolute bottom-3 right-3 z-10 max-w-[min(100%-1.5rem,300px)] rounded-lg border border-amber-500/35 bg-st-bg/95 px-3 py-2 text-sm shadow-lg backdrop-blur-sm">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 space-y-1">
              <div className="truncate font-medium text-st-fg">
                {selectedTrader.captainDisplayName ?? traderDisplayName(selectedTrader)}
              </div>
              <div className="text-[11px] text-st-muted">
                {selectedTrader.operatorKind === "player"
                  ? "Player trader"
                  : selectedTrader.operatorKind === "npc"
                    ? "NPC trader"
                    : "Trader"}
                {selectedTrader.captainAffiliation ? (
                  <span className="block truncate text-st-muted/90">
                    {selectedTrader.captainAffiliation}
                  </span>
                ) : null}
              </div>
              <div className="text-xs text-st-fg">
                <span className="font-medium">
                  {systems.find((s) => s._id === selectedTrader.originSystemId)?.name ?? "?"}
                </span>
                <span className="mx-1 text-st-muted">&gt;</span>
                <span className="font-medium">
                  {systems.find((s) => s._id === selectedTrader.destinationSystemId)?.name ?? "?"}
                </span>
              </div>
              <div className="text-xs text-st-muted">
                Arriving in{" "}
                <span className="font-mono text-amber-200/90">
                  {Math.max(0, selectedTrader.etaTurn - activeGame.currentTurn)}
                </span>{" "}
                turn
                {Math.max(0, selectedTrader.etaTurn - activeGame.currentTurn) === 1 ? "" : "s"}
              </div>
              <div className="text-xs text-st-fg">
                <span className="text-st-muted">Cargo:</span>{" "}
                {selectedTrader.cargoUnits.toLocaleString()}{" "}
                <span className="capitalize">{selectedTrader.commodity}</span>
              </div>
            </div>
            <button
              type="button"
              className="shrink-0 text-xs text-st-muted underline hover:text-st-fg"
              onClick={() => handleTraderSelect(null)}
            >
              Close
            </button>
          </div>
        </div>
      ) : null}
      {fleetPanelInner !== null && !playerHomeMapLayout ? (
        <div className="pointer-events-auto absolute bottom-3 left-3 z-10 max-w-[min(100%-1.5rem,280px)] rounded-lg border border-st-border bg-st-bg/95 px-3 py-2 text-sm shadow-lg backdrop-blur-sm">
          {fleetPanelInner}
        </div>
      ) : null}
      {showColonyShipPanel && selectedColonyShip !== undefined && activeGame ? (
        <ColonyShipFloatingPanel
          ship={selectedColonyShip}
          currentTurn={activeGame.currentTurn}
          systems={systems}
          links={links}
          empires={empires}
          minInhabitedPopulation={MIN_INHABITED_POPULATION}
          onClose={() => handleSelectedColonyShipChange(null)}
          onDispatch={async (toSystemId) => {
            setColonyMutationError(null);
            try {
              await dispatchColonyShip({
                gameId: activeGame._id,
                colonyShipId: selectedColonyShip._id,
                routeSystemIds: [toSystemId as Id<"gal_systems">],
              });
            } catch (e) {
              setColonyMutationError(
                e instanceof Error ? e.message : "Could not dispatch colony ship.",
              );
            }
          }}
          onColonize={async () => {
            setColonyMutationError(null);
            try {
              await colonizeWithColonyShip({
                gameId: activeGame._id,
                colonyShipId: selectedColonyShip._id,
              });
              handleSelectedColonyShipChange(null);
            } catch (e) {
              setColonyMutationError(
                e instanceof Error ? e.message : "Could not colonize.",
              );
            }
          }}
          mutationError={colonyMutationError}
        />
      ) : null}
      {showRouteEditor && editingRoute !== null ? (
        <div className="pointer-events-auto absolute bottom-3 left-1/2 z-10 max-w-[min(100%-1.5rem,340px)] -translate-x-1/2 rounded-lg border border-violet-500/40 bg-st-bg/95 px-3 py-2 text-sm shadow-lg backdrop-blur-sm">
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-violet-300">
                Recurring route
              </div>
              <div className="mt-1 font-medium text-st-fg">
                {systems.find((s) => s._id === editingRoute.originSystemId)?.name ??
                  "?"}{" "}
                →{" "}
                {systems.find((s) => s._id === editingRoute.destinationSystemId)?.name ??
                  "?"}
              </div>
            </div>
            <button
              type="button"
              className="shrink-0 text-xs text-st-muted underline hover:text-st-fg"
              onClick={dismissRouteEditor}
            >
              Close
            </button>
          </div>
          <label className="mt-3 block text-xs text-st-muted">
            Share of idle garrison each turn: {routeEditorPct}%
            <input
              type="range"
              min={0}
              max={100}
              value={routeEditorPct}
              onChange={(e) => setRouteEditorPct(Number(e.target.value))}
              className="mt-2 w-full accent-violet-400"
            />
          </label>
          <label className="mt-2 flex items-center gap-2 text-xs text-st-muted">
            <input
              type="checkbox"
              checked={routeEditorEnabled}
              onChange={(e) => setRouteEditorEnabled(e.target.checked)}
            />
            Route active
          </label>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              type="button"
              className="flex-1"
              disabled={routeEditorEnabled && routeEditorPct < 1}
              onClick={() => void saveRouteEditor()}
            >
              Apply
            </Button>
            <Button type="button" variant="secondary" onClick={() => void clearRouteEditor()}>
              Remove route
            </Button>
          </div>
          <p className="mt-2 text-[11px] leading-snug text-st-muted">
            Violet dashed lines show standing routes. Tap the dot on the line to open this panel.
          </p>
        </div>
      ) : null}
    </section>
  );
}

const COLONY_SHIP_CARGO_DISPLAY = 50_000;

type ColonyShipRow = {
  _id: string;
  name: string;
  empireId: string;
  originSystemId: string;
  status: "idle" | "enRoute";
  destinationSystemId?: string | null;
  etaTurn?: number | null;
  dispatchedTurn?: number;
  travelTurnsTotal?: number;
};

type EmpireRow = { _id: string; homeSystemId: string | null };

function ColonyShipFloatingPanel({
  ship,
  currentTurn,
  systems,
  links,
  empires,
  minInhabitedPopulation,
  onClose,
  onDispatch,
  onColonize,
  mutationError,
}: {
  ship: ColonyShipRow;
  currentTurn: number;
  systems: { _id: string; name: string; ownerEmpireId: string | null; population?: number }[];
  links: { fromSystemId: string; toSystemId: string }[];
  empires: EmpireRow[];
  minInhabitedPopulation: number;
  onClose: () => void;
  onDispatch: (toSystemId: string) => Promise<void>;
  onColonize: () => Promise<void>;
  mutationError: string | null;
}) {
  const empire = empires.find((e) => e._id === ship.empireId);
  const atHomeworld =
    empire?.homeSystemId !== undefined &&
    empire?.homeSystemId !== null &&
    empire.homeSystemId === ship.originSystemId;

  const originSystem = systems.find((s) => s._id === ship.originSystemId);
  const originName = originSystem?.name ?? "Unknown";
  const atOwnEmpireWorld =
    originSystem !== undefined && originSystem.ownerEmpireId === ship.empireId;

  const neighborIds = new Set<string>();
  for (const link of links) {
    if (link.fromSystemId === ship.originSystemId) neighborIds.add(link.toSystemId);
    if (link.toSystemId === ship.originSystemId) neighborIds.add(link.fromSystemId);
  }
  const neighbors = [...neighborIds]
    .map((id) => ({ id, name: systems.find((s) => s._id === id)?.name ?? id }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const canColonizeFromShip =
    ship.status === "idle" &&
    originSystem !== undefined &&
    originSystem.ownerEmpireId === null &&
    (originSystem.population ?? 0) < minInhabitedPopulation;

  const destName =
    ship.destinationSystemId !== undefined && ship.destinationSystemId !== null
      ? (systems.find((s) => s._id === ship.destinationSystemId)?.name ?? "?")
      : null;

  return (
    <div className="pointer-events-auto absolute bottom-20 left-3 z-10 max-w-[min(100%-1.5rem,300px)] rounded-lg border border-teal-500/40 bg-st-bg/95 px-3 py-2 text-sm shadow-lg backdrop-blur-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-xs font-semibold uppercase tracking-wide text-teal-300/90">
            Colony ship
          </div>
          <div className="mt-0.5 truncate font-medium text-st-fg">{ship.name}</div>
          <div className="mt-0.5 text-xs text-st-muted">
            {ship.status === "enRoute" ? (
              <>
                <span className="font-medium text-st-fg">{originName}</span>
                <span className="mx-1">&gt;</span>
                <span className="font-medium text-st-fg">{destName}</span>
                {ship.etaTurn !== undefined && ship.etaTurn !== null ? (
                  <span className="ml-1 block text-st-muted">
                    ETA turn {ship.etaTurn} (
                    {Math.max(0, ship.etaTurn - currentTurn)} turn
                    {Math.max(0, ship.etaTurn - currentTurn) === 1 ? "" : "s"} left)
                  </span>
                ) : null}
              </>
            ) : (
              <>
                At <span className="font-medium text-st-fg">{originName}</span> · idle
              </>
            )}
          </div>
          <p className="mt-1 text-[11px] text-st-muted">
            Non-combat transport · carries {COLONY_SHIP_CARGO_DISPLAY.toLocaleString()} people ·
            single-use colonize
          </p>
          {ship.status === "idle" && atOwnEmpireWorld ? (
            <p className="mt-1.5 text-[10px] leading-snug text-teal-200/75">
              Drag from the colony ship on the map to a linked star — same as fleets. Each order moves along
              one hop (valid routes follow your territory, then up to{" "}
              {MAX_COLONY_ROUTE_HOPS_BEYOND_EMPIRE} beyond). Neighbor buttons are one-hop shortcuts.
            </p>
          ) : null}
        </div>
        <button
          type="button"
          className="shrink-0 text-xs text-st-muted underline hover:text-st-fg"
          onClick={onClose}
        >
          Close
        </button>
      </div>
      {mutationError !== null ? (
        <p className="mt-2 text-xs text-red-400">{mutationError}</p>
      ) : null}
      {ship.status === "idle" && atOwnEmpireWorld && neighbors.length > 0 ? (
        <div className="mt-3 border-t border-st-border pt-2">
          <div className="text-[11px] font-medium text-st-muted">Dispatch to neighbor</div>
          <p className="mt-0.5 text-[10px] text-st-muted">
            {atHomeworld
              ? `Costs ${COLONY_SHIP_CARGO_DISPLAY.toLocaleString()} people from your homeworld.`
              : "Cargo already aboard — no population deducted from this colony."}
          </p>
          <ul className="mt-2 flex max-h-28 flex-col gap-1 overflow-y-auto">
            {neighbors.map((n) => (
              <li key={n.id}>
                <Button
                  type="button"
                  variant="secondary"
                  className="h-8 w-full justify-start text-xs"
                  onClick={() => void onDispatch(n.id)}
                >
                  {n.name}
                </Button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {ship.status === "idle" && canColonizeFromShip ? (
        <div className="mt-3 border-t border-st-border pt-2">
          <Button type="button" className="w-full" onClick={() => void onColonize()}>
            Colonize
          </Button>
          <p className="mt-1 text-[10px] text-st-muted">
            Founds a colony with {COLONY_SHIP_CARGO_DISPLAY.toLocaleString()} population and food
            infrastructure bonus. The ship is consumed.
          </p>
        </div>
      ) : null}
    </div>
  );
}

function traderDisplayName(t: { commodity: string; _id: string }): string {
  const raw = t.commodity.trim();
  const label =
    raw.length === 0 ? "Cargo" : raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase();
  return `${label} freighter · ${t._id.slice(-4)}`;
}

// ---------------------------------------------------------------------------
// Star system info panel
// ---------------------------------------------------------------------------

const MAX_IMPORT_SUBSIDY_DISPLAY = 30;
const DEFAULT_TRADER_DOCKING_COST = 100;
/** Matches HOMEWORLD_DEFENSE_MULTIPLIER in Convex combat resolution. */
const HOMEWORLD_DEFENSE_ADVANTAGE_MULT = 1.15;

type RecentCombatInfo = {
  battleId: string;
  status: "active" | "resolved";
  startedTurn: number;
  endedTurn: number | null;
  foodStockpileDamage: number;
  weaponsStockpileDamage?: number;
  researchStockpileDamage?: number;
  populationDamage?: number;
  attackerShipsDestroyed?: number;
  defenderShipsDestroyed?: number;
};

type FleetAtSystemInfo = {
  id: string;
  name: string;
  empireId: string;
  strength: number;
  status: "idle" | "engaged" | "enRoute";
};

type ColonyShipAtSystemInfo = {
  id: string;
  name: string;
  empireId: string;
  status: "idle" | "enRoute";
  mothershipDefenseDamage?: number;
};

type SystemDoc = {
  _id: string;
  name: string;
  systemKey: string;
  x: number;
  y: number;
  resourceRichness: number;
  baseProductivity?: number;
  isHomeworld: boolean;
  ownerEmpireId: string | null;
  population?: number;
  stockFood?: number;
  emphasisFood?: number;
  emphasisShips?: number;
  emphasisResearch?: number;
  foodPrice?: number;
  foodImportSubsidyPerUnit?: number;
  recentDamagePopulation?: number;
  colonyShipBuildEnabled?: boolean;
  colonyShipBuildProgress?: number;
  colonyShipBuildCost?: number;
};

function formatWhole(n: number): string {
  return Math.round(n).toLocaleString();
}

/** Compact food stockpile labels (e.g. 58k food, 12 mill food). */
function formatFoodStockpileCompact(n: number): string {
  const x = Math.round(Number.isFinite(n) ? n : 0);
  if (x <= 0) return "0 food";
  if (x < 1000) return `${x.toLocaleString("en-US")} food`;
  if (x < 1_000_000) return `${Math.round(x / 1000)}k food`;
  if (x < 1_000_000_000) {
    const m = x / 1_000_000;
    const simplified =
      m >= 10 || Math.abs(m - Math.round(m)) < 0.05
        ? Math.round(m).toString()
        : (Math.round(m * 10) / 10).toFixed(1).replace(/\.0$/, "");
    return `${simplified} mill food`;
  }
  return `${Math.round(x / 1_000_000_000)} bill food`;
}

function PlanetInfoRow({
  label,
  value,
  valueClassName = "text-st-fg",
}: {
  label: string;
  value: string;
  valueClassName?: string;
}) {
  return (
    <div className="flex justify-between gap-3 border-b border-st-border/40 pb-1.5 last:border-0 last:pb-0">
      <dt className="text-st-muted">{label}</dt>
      <dd className={`max-w-[60%] text-right font-mono ${valueClassName}`}>{value}</dd>
    </div>
  );
}

function PlanetInfoEmptyPanel() {
  return (
    <div className="mt-3 rounded-lg border border-st-border bg-st-bg/80 px-3 py-3 text-sm shadow-sm">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-st-muted">
        Planet info
      </h3>
      <p className="mt-2 text-sm text-st-muted">
        Click a star on the galaxy map to inspect owner, economy, fleet, trade, and recent combat
        details here.
      </p>
    </div>
  );
}

function StarSystemPanel({
  system,
  empireNames,
  selectedNeighbors,
  showColonyOperationalIntel,
  fleetSelectionAllowed,
  canEdit,
  emphasisHint,
  emphasisSaveError,
  importSubsidyError,
  priorityMutationError,
  isPriorityStar,
  canMarkPriorityStar,
  priorityDisabledReason,
  priorityEmpireId,
  priorityEmpireOptions,
  canChoosePriorityEmpire,
  onPriorityEmpireChange,
  localShipsPct,
  onLocalShipsPctChange,
  onShipsPctCommit,
  onImportSubsidyDelta,
  onPriorityStarToggle,
  onNeighborNavigate,
  onClose,
  foodStockpileMinPerPop,
  foodStockpileMaxPerPop,
  foodStressFactor,
  dockingFee,
  fleetSize,
  fleetsAtSystem,
  colonyShipsAtSystem,
  defenseAdvantage,
  recentCombat,
  canUseColonyShips,
  canColonizeAtStar,
  colonizeShipId,
  idleColonyShipIdForNeighborDispatch,
  colonyMutationError,
  gameIdForColony,
  onStartColonyBuild,
  onCancelColonyBuild,
  onDispatchColonyFromStarPanel,
  onColonizeFromStarPanel,
  onFleetCardTap,
}: {
  system: SystemDoc;
  empireNames: Record<string, string>;
  selectedNeighbors: { id: string; name: string }[];
  showColonyOperationalIntel: boolean;
  fleetSelectionAllowed: (fleetEmpireId: string) => boolean;
  canEdit: boolean;
  emphasisHint: string | null;
  emphasisSaveError: string | null;
  importSubsidyError: string | null;
  priorityMutationError: string | null;
  isPriorityStar: boolean;
  canMarkPriorityStar: boolean;
  priorityDisabledReason: string | null;
  priorityEmpireId: Id<"emp_states"> | null;
  priorityEmpireOptions: Array<{ _id: Id<"emp_states">; name: string }>;
  canChoosePriorityEmpire: boolean;
  onPriorityEmpireChange: (empireId: Id<"emp_states">) => void;
  localShipsPct: number | null;
  onLocalShipsPctChange: (v: number) => void;
  onShipsPctCommit: (v: number) => Promise<void>;
  onImportSubsidyDelta: (delta: number) => Promise<void>;
  onPriorityStarToggle: (enabled: boolean) => Promise<void>;
  onNeighborNavigate: (systemId: string) => void;
  onClose: () => void;
  foodStockpileMinPerPop: number;
  foodStockpileMaxPerPop: number;
  foodStressFactor: number;
  dockingFee: number;
  fleetSize: number;
  fleetsAtSystem: FleetAtSystemInfo[];
  colonyShipsAtSystem: ColonyShipAtSystemInfo[];
  defenseAdvantage: number;
  recentCombat: RecentCombatInfo | null | undefined;
  canUseColonyShips?: boolean;
  canColonizeAtStar?: boolean;
  colonizeShipId?: string | null;
  idleColonyShipIdForNeighborDispatch?: string | null;
  colonyMutationError?: string | null;
  gameIdForColony?: Id<"sim_games"> | null;
  onStartColonyBuild?: () => Promise<void>;
  onCancelColonyBuild?: () => Promise<void>;
  onDispatchColonyFromStarPanel?: (toSystemId: string) => Promise<void>;
  onColonizeFromStarPanel?: () => Promise<void>;
  onFleetCardTap?: (fleetId: string) => void;
}) {
  const [importBonusInfoOpen, setImportBonusInfoOpen] = useState(false);
  const [homeworldInfoOpen, setHomeworldInfoOpen] = useState(false);
  const [colonyBusy, setColonyBusy] = useState(false);
  const [planetPanelTab, setPlanetPanelTab] = useState<
    "food" | "fleet" | "battle" | "routes"
  >(showColonyOperationalIntel ? "food" : "routes");
  const runColonyAction = useCallback(async (fn: () => Promise<void>) => {
    setColonyBusy(true);
    try {
      await fn();
    } finally {
      setColonyBusy(false);
    }
  }, []);
  const pop = system.population ?? 0;
  const stockFood = system.stockFood ?? 0;
  const emphasisResearch = system.emphasisResearch ?? 33;
  const emphasisShips = system.emphasisShips ?? 33;

  const sliderShips = localShipsPct ?? emphasisShips;
  const maxShips = Math.max(0, 100 - emphasisResearch);
  const currentFood = Math.max(0, 100 - Math.round(sliderShips) - emphasisResearch);

  const preview = previewColonyFoodFlows({
    populationPeople: pop,
    resourceRichness: system.resourceRichness,
    baseProductivity: system.baseProductivity,
    emphasisFood: currentFood,
    emphasisShips: Math.round(sliderShips),
    emphasisResearch,
    isHomeworld: system.isHomeworld,
    recentDamagePopulation: system.recentDamagePopulation,
  });

  const foodScores = foodProdDemandDisplay(preview);
  const foodScoreFmt = (n: number) => n.toFixed(1);

  const demandForStockBands = foodDemandForStockThresholds(preview);
  const stockBand = foodStockpileBand(
    stockFood,
    preview.demandTotal,
    foodStockpileMinPerPop,
    foodStockpileMaxPerPop,
  );
  const stockMinUnits = demandForStockBands * foodStockpileMinPerPop;
  const stockMaxUnits = demandForStockBands * foodStockpileMaxPerPop;
  const stockStatusTitle = `${Math.round(stockFood)} food units stored. Comfort band vs one-turn need: below ${stockMinUnits.toFixed(1)} is low; above ${stockMaxUnits.toFixed(1)} is oversupply.`;
  const hasFoodEconomy = pop > 0;
  const foodStressRatio =
    hasFoodEconomy && stockMinUnits > 0
      ? Math.max(0, (stockMinUnits - stockFood) / stockMinUnits)
      : 0;
  const foodStressLabel =
    !hasFoodEconomy
      ? "N/A"
      : foodStressRatio <= 0
        ? "None"
        : `${Math.round(foodStressRatio * 100)}% below minimum (x${foodStressFactor.toFixed(1)})`;

  const turnsLeft =
    preview.netTotal >= 0 ? Infinity : stockFood / Math.abs(preview.netTotal);

  const eqShips = equilibriumShipsPct(system.resourceRichness, emphasisResearch, {
    baseProductivity: system.baseProductivity,
    isHomeworld: system.isHomeworld,
    recentDamagePopulation: system.recentDamagePopulation,
    populationPeople: pop,
  });

  const marketFoodCr = system.foodPrice;
  const importSubsidy = Math.max(0, system.foodImportSubsidyPerUnit ?? 0);
  const traderOfferCr = (marketFoodCr ?? FOOD_PRICE_DEFAULT_CR) + importSubsidy;

  const foodStatusColor =
    turnsLeft === Infinity ? "text-emerald-400" :
    turnsLeft > 3 ? "text-amber-300" :
    "text-red-400";

  const foodStatusLabel =
    turnsLeft === Infinity
      ? "Increasing"
      : turnsLeft > 3
        ? `${Math.floor(turnsLeft)} turns`
        : turnsLeft > 0
          ? `⚠ ${turnsLeft.toFixed(1)} turns`
          : "⛔ starving";

  const recentCombatTotalDamage =
    recentCombat === null || recentCombat === undefined
      ? 0
      : recentCombat.foodStockpileDamage +
        (recentCombat.weaponsStockpileDamage ?? 0) +
        (recentCombat.researchStockpileDamage ?? 0) +
        (recentCombat.populationDamage ?? 0);
  const recentCombatDamageParts =
    recentCombat === null || recentCombat === undefined
      ? []
      : [
          recentCombat.foodStockpileDamage > 0
            ? `${formatWhole(recentCombat.foodStockpileDamage)} food`
            : null,
          (recentCombat.weaponsStockpileDamage ?? 0) > 0
            ? `${formatWhole(recentCombat.weaponsStockpileDamage ?? 0)} weapons`
            : null,
          (recentCombat.researchStockpileDamage ?? 0) > 0
            ? `${formatWhole(recentCombat.researchStockpileDamage ?? 0)} research`
            : null,
          (recentCombat.populationDamage ?? 0) > 0
            ? `${formatPopulationPeople(recentCombat.populationDamage ?? 0)} pop`
            : null,
        ].filter((part): part is string => part !== null);

  const buildCost = system.colonyShipBuildCost ?? 0;
  const buildProgress = system.colonyShipBuildProgress ?? 0;
  const colonyBuildInProgress =
    system.colonyShipBuildEnabled === true && buildCost > 0 && buildProgress < buildCost;

  const showHomeworldColonyUi =
    canUseColonyShips === true &&
    canEdit &&
    system.isHomeworld &&
    gameIdForColony != null &&
    system.ownerEmpireId !== null;

  const showColonizeInStarPanel =
    canColonizeAtStar === true &&
    colonizeShipId != null &&
    gameIdForColony != null &&
    onColonizeFromStarPanel != null;

  const idleColonyDispatchAtHomeworld =
    canUseColonyShips === true &&
    gameIdForColony != null &&
    idleColonyShipIdForNeighborDispatch != null &&
    onDispatchColonyFromStarPanel != null &&
    system.isHomeworld;

  const showIdleColonyNeighborAwayFromHomeworld =
    canUseColonyShips === true &&
    gameIdForColony != null &&
    idleColonyShipIdForNeighborDispatch != null &&
    onDispatchColonyFromStarPanel != null &&
    !system.isHomeworld;

  return (
    <div className="mt-3 rounded-lg border border-st-border bg-st-bg/95 px-3 py-3 text-sm shadow-sm">
      {importBonusInfoOpen ? (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/55 p-4"
          role="presentation"
          onClick={() => setImportBonusInfoOpen(false)}
        >
          <div
            role="dialog"
            aria-labelledby="import-bonus-info-title"
            className="max-w-sm rounded-lg border border-st-border bg-st-panel p-4 text-sm text-st-fg shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="import-bonus-info-title" className="font-semibold text-st-fg">
              Import bonus
            </h2>
            <p className="mt-2 text-xs leading-relaxed text-st-muted">
              Bonus is paid from the empire&apos;s treasury when cargo arrives. If the treasury is empty,
              traders only receive the market price.
            </p>
            <Button type="button" variant="secondary" className="mt-4 w-full" onClick={() => setImportBonusInfoOpen(false)}>
              Close
            </Button>
          </div>
        </div>
      ) : null}
      {homeworldInfoOpen ? (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/55 p-4"
          role="presentation"
          onClick={() => setHomeworldInfoOpen(false)}
        >
          <div
            role="dialog"
            aria-labelledby="homeworld-info-title"
            className="max-w-sm rounded-lg border border-st-border bg-st-panel p-4 text-sm text-st-fg shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="homeworld-info-title" className="font-semibold text-st-fg">
              Homeworld
            </h2>
            <p className="mt-2 text-xs leading-relaxed text-st-muted">
              This system is an empire capital. Homeworlds receive stronger economic output from the same
              production mix (about +50% to local food output and to the productivity that drives ships and
              research here), collect higher taxes from the population (about +25%), and are treated as a
              last foothold when an empire collapses. In combat, defending fleets and infrastructure here get
              modest defensive bonuses compared with ordinary colonies.
            </p>
            <Button type="button" variant="secondary" className="mt-4 w-full" onClick={() => setHomeworldInfoOpen(false)}>
              Close
            </Button>
          </div>
        </div>
      ) : null}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <div className="font-medium leading-snug text-st-fg">{system.name}</div>
            {system.isHomeworld ? (
              <button
                type="button"
                title="Homeworld — what this means"
                aria-label="Homeworld information"
                className="inline-flex shrink-0 rounded p-0.5 text-amber-400/90 hover:bg-st-panel hover:text-amber-300"
                onClick={() => setHomeworldInfoOpen(true)}
              >
                <Star className="size-4 fill-current" aria-hidden />
              </button>
            ) : null}
            {isPriorityStar ? (
              <span className="rounded-full border border-cyan-400/50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-cyan-200">
                Priority
              </span>
            ) : null}
          </div>
          <div className="mt-0.5 font-mono text-xs text-st-muted">{system.systemKey}</div>
          <div className="mt-2">
            {canChoosePriorityEmpire ? (
              <label className="mb-1.5 block text-[10px] font-medium uppercase tracking-wide text-st-muted">
                Priority for
                <select
                  className="mt-1 block w-full rounded border border-st-border bg-st-bg px-2 py-1 text-xs normal-case tracking-normal text-st-fg"
                  value={priorityEmpireId ?? ""}
                  onChange={(event) => {
                    const empireId = event.target.value as Id<"emp_states">;
                    if (empireId !== "") onPriorityEmpireChange(empireId);
                  }}
                >
                  {priorityEmpireOptions.map((empire) => (
                    <option key={empire._id} value={empire._id}>
                      {empire.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <Button
              type="button"
              variant="secondary"
              aria-pressed={isPriorityStar}
              className={`inline-flex h-7 items-center gap-1.5 px-2 text-[11px] ${
                isPriorityStar
                  ? "border-cyan-400/70 bg-cyan-950/40 text-cyan-100 hover:border-cyan-300"
                  : ""
              }`}
              disabled={!canMarkPriorityStar}
              onClick={() => void onPriorityStarToggle(!isPriorityStar)}
              title={
                canMarkPriorityStar
                  ? "Mark this star as a strategic Priority star for the selected empire"
                  : (priorityDisabledReason ?? "Priority stars are unavailable right now")
              }
            >
              <Star
                className={isPriorityStar ? "size-3 fill-current" : "size-3"}
                aria-hidden
              />
              {isPriorityStar ? "Unmark Priority star" : "Mark Priority star"}
            </Button>
            {priorityMutationError !== null ? (
              <p className="mt-1 text-[10px] text-red-400">{priorityMutationError}</p>
            ) : null}
            {!canMarkPriorityStar && priorityDisabledReason !== null ? (
              <p className="mt-1 text-[10px] leading-snug text-amber-300/90">
                {priorityDisabledReason}
              </p>
            ) : null}
          </div>
        </div>
        <button
          type="button"
          className="shrink-0 text-xs text-st-muted underline hover:text-st-fg"
          onClick={onClose}
        >
          Close
        </button>
      </div>

      <dl className="mt-3 grid gap-x-5 gap-y-2 text-xs sm:grid-cols-2 xl:grid-cols-3">
        <PlanetInfoRow
          label="Owner"
          value={
            system.ownerEmpireId === null
              ? "Independent"
              : (empireNames[system.ownerEmpireId] ?? "Unknown")
          }
        />
        <PlanetInfoRow
          label="Resource richness"
          value={`${Math.round(system.resourceRichness * 100)}%`}
        />
        <PlanetInfoRow
          label="Population"
          value={pop > 0 ? formatPopulationPeople(pop) : "0"}
        />
      </dl>

      {showColonyOperationalIntel && pop > 0 ? (
        <dl className="mt-3 flex flex-col space-y-2 text-xs">
          {/* Ship production effort slider */}
          <div className="rounded border border-st-border/60 bg-st-panel/50 px-2 py-1.5">
            <div className="mb-1 flex items-center justify-between gap-1">
              <span className="text-st-muted">Ship production effort</span>
              <span className="font-mono text-st-fg">{Math.round(sliderShips)}%</span>
            </div>
            <div className="relative">
              {/* Equilibrium marker */}
              <div
                className="pointer-events-none absolute top-0 h-full"
                style={{
                  left: `${maxShips > 0 ? (eqShips / maxShips) * 100 : 0}%`,
                }}
              >
                <div className="relative -translate-x-1/2">
                  <div className="h-4 w-0.5 bg-emerald-400/80" title="Food equilibrium" />
                </div>
              </div>
              <input
                type="range"
                min={0}
                max={maxShips}
                step={1}
                value={Math.round(sliderShips)}
                disabled={!canEdit}
                onChange={(e) => onLocalShipsPctChange(Number(e.target.value))}
                onMouseUp={(e) => {
                  if (!canEdit) return;
                  void onShipsPctCommit(Number((e.target as HTMLInputElement).value));
                }}
                onTouchEnd={(e) => {
                  if (!canEdit) return;
                  void onShipsPctCommit(Number((e.target as HTMLInputElement).value));
                }}
                className="w-full accent-cyan-400 disabled:opacity-50"
              />
            </div>
            <div className="mt-0.5 flex justify-between text-[10px] text-st-muted">
              <span>← more food</span>
              <span className="text-emerald-400/80">
                ▲{Math.round(eqShips)}% equilibrium
              </span>
              <span>more ships →</span>
            </div>
            <div className="mt-1 flex justify-between text-[10px]">
              <span className="text-st-muted">Food effort</span>
              <span className="font-mono text-st-fg">{currentFood}%</span>
            </div>
            {emphasisSaveError !== null ? (
              <p className="mt-1 text-[10px] text-red-400">{emphasisSaveError}</p>
            ) : !canEdit && emphasisHint !== null ? (
              <p className="mt-1 text-[10px] text-st-muted">{emphasisHint}</p>
            ) : null}
          </div>
        </dl>
      ) : null}

      <div
        className="mt-3 flex flex-wrap gap-0.5 border-b border-st-border/70"
        role="tablist"
        aria-label="Planet detail sections"
      >
        {(
          [
            ["food", "Food"],
            ["fleet", "Fleet"],
            ["battle", "Battle"],
            ["routes", "Routes"],
          ] as const
        ).map(([tabId, label]) => {
          const foodFleetLocked =
            !showColonyOperationalIntel && (tabId === "food" || tabId === "fleet");
          const selected = planetPanelTab === tabId;
          return (
            <button
              key={tabId}
              type="button"
              role="tab"
              id={`planet-tab-${tabId}`}
              aria-selected={selected}
              aria-disabled={foodFleetLocked}
              title={
                foodFleetLocked ? "This information is not available to other empires" : undefined
              }
              className={
                foodFleetLocked
                  ? "-mb-px cursor-not-allowed rounded-t border-b-2 border-transparent px-2.5 py-1.5 text-[11px] font-medium text-st-muted opacity-45"
                  : selected
                    ? "-mb-px rounded-t border-b-2 border-cyan-400 bg-st-panel/40 px-2.5 py-1.5 text-[11px] font-semibold text-st-fg"
                    : "-mb-px rounded-t border-b-2 border-transparent px-2.5 py-1.5 text-[11px] font-medium text-st-muted hover:text-st-fg"
              }
              onClick={() => {
                if (!foodFleetLocked) setPlanetPanelTab(tabId);
              }}
            >
              {label}
            </button>
          );
        })}
      </div>

      <div
        className="mt-3 text-xs"
        role="tabpanel"
        aria-labelledby={`planet-tab-${planetPanelTab}`}
      >
        {planetPanelTab === "food" && showColonyOperationalIntel ? (
          <>
            <dl className="flex flex-col space-y-2 text-xs">
              {pop > 0 ? (
                <>
                  <div className="rounded border border-st-border/60 bg-st-panel/50 px-2 py-1.5">
                    <div className="text-[11px] font-medium text-st-muted">Food imports &amp; traders</div>
                    <div className="mt-1 flex justify-between gap-2 text-xs">
                      <span className="text-st-muted">Market food price</span>
                      <span className="font-mono text-st-fg">
                        {marketFoodCr !== undefined
                          ? `${marketFoodCr.toFixed(1)} cr/u`
                          : `— (≈${FOOD_PRICE_DEFAULT_CR} baseline until priced)`}
                      </span>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center justify-between gap-2 text-xs">
                      <div className="flex items-center gap-1">
                        <span className="text-st-muted">Import bonus</span>
                        <button
                          type="button"
                          className="inline-flex rounded p-0.5 text-st-muted hover:bg-st-bg hover:text-st-fg"
                          title="How import bonus is paid"
                          aria-label="Import bonus information"
                          onClick={() => setImportBonusInfoOpen(true)}
                        >
                          <Info className="size-3.5" aria-hidden />
                        </button>
                      </div>
                      <div className="flex items-center gap-1">
                        <Button
                          type="button"
                          variant="secondary"
                          className="size-7 shrink-0 p-0"
                          title="Lower bonus paid to food importers"
                          disabled={!canEdit || importSubsidy <= 0}
                          onClick={() => void onImportSubsidyDelta(-1)}
                        >
                          <Minus className="size-3.5" aria-hidden />
                        </Button>
                        <span className="min-w-[2.5rem] text-center font-mono text-st-fg">
                          {importSubsidy} cr/u
                        </span>
                        <Button
                          type="button"
                          variant="secondary"
                          className="size-7 shrink-0 p-0"
                          title="Raise bonus so traders earn more delivering here"
                          disabled={!canEdit || importSubsidy >= MAX_IMPORT_SUBSIDY_DISPLAY}
                          onClick={() => void onImportSubsidyDelta(1)}
                        >
                          <Plus className="size-3.5" aria-hidden />
                        </Button>
                      </div>
                    </div>
                    <div className="mt-0.5 flex justify-between gap-2 text-xs">
                      <span className="text-st-muted">Traders&apos; offered sell price</span>
                      <span className="font-mono text-amber-200/90">{traderOfferCr.toFixed(1)} cr/u</span>
                    </div>
                    {importSubsidyError !== null ? (
                      <p className="mt-1 text-[10px] text-red-400">{importSubsidyError}</p>
                    ) : null}
                  </div>

                  <div className="rounded border border-st-border/60 bg-st-panel/50 px-2 py-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-st-muted">Food stock</span>
                      <span
                        className={`text-right font-medium ${
                          stockBand === "below" ? "text-red-400" : "text-emerald-400"
                        }`}
                        title={stockStatusTitle}
                      >
                        {stockBand === "below"
                          ? "Below Minimum"
                          : stockBand === "oversupply"
                            ? "Oversupply"
                            : "Acceptable"}
                      </span>
                    </div>
                    <div className="mt-0.5 flex items-center justify-between gap-2">
                      <span className="text-st-muted">Food surplus</span>
                      <span className={`font-mono font-semibold ${foodStatusColor}`}>
                        {foodStatusLabel}
                      </span>
                    </div>
                    <div
                      className="mt-1 flex items-center justify-between gap-2 text-xs"
                      title="Production index vs need index. The second number is always 5 — your colony’s food need this turn on that scale. The first tracks local output; the value in parentheses is surplus (+) or shortfall (−)."
                    >
                      <span className="text-st-muted">Prod / demand</span>
                      <span className="font-mono text-st-fg">
                        {foodScoreFmt(foodScores.prod)} / {foodScoreFmt(foodScores.demand)}
                        <span className={foodScores.net >= 0 ? "text-emerald-400" : "text-red-400"}>
                          {" "}
                          ({foodScores.net >= 0 ? "+" : ""}
                          {foodScoreFmt(foodScores.net)})
                        </span>
                      </span>
                    </div>
                  </div>
                </>
              ) : (
                <p className="text-st-muted">No population — no local food economy.</p>
              )}
            </dl>
            <dl className="mt-3 grid gap-x-5 gap-y-2 text-xs sm:grid-cols-2 xl:grid-cols-3">
              <PlanetInfoRow
                label="Food stockpile"
                value={formatFoodStockpileCompact(stockFood)}
                valueClassName={
                  hasFoodEconomy && stockFood < stockMinUnits
                    ? "text-red-400"
                    : hasFoodEconomy && stockFood > stockMaxUnits
                      ? "text-emerald-400"
                      : "text-st-fg"
                }
              />
              <PlanetInfoRow
                label="Stockpile minimum"
                value={hasFoodEconomy ? formatFoodStockpileCompact(stockMinUnits) : "N/A"}
                valueClassName={
                  hasFoodEconomy && stockFood > stockMinUnits ? "text-emerald-400" : "text-st-fg"
                }
              />
              <PlanetInfoRow
                label="Stockpile maximum"
                value={hasFoodEconomy ? formatFoodStockpileCompact(stockMaxUnits) : "N/A"}
                valueClassName={
                  hasFoodEconomy && stockFood > stockMaxUnits ? "text-emerald-400" : "text-st-fg"
                }
              />
              <PlanetInfoRow label="Food stress" value={foodStressLabel} />
              <PlanetInfoRow
                label="Market food price"
                value={
                  marketFoodCr !== undefined
                    ? `${marketFoodCr.toFixed(1)} cr/u`
                    : `~${FOOD_PRICE_DEFAULT_CR} cr/u`
                }
              />
              <PlanetInfoRow label="Import bonus" value={`${importSubsidy.toFixed(1)} cr/u`} />
              <PlanetInfoRow
                label="Price offered for food cargo"
                value={`${traderOfferCr.toFixed(1)} cr/u`}
              />
              <PlanetInfoRow label="Docking fee" value={`${formatWhole(dockingFee)} cr`} />
            </dl>
          </>
        ) : null}

        {planetPanelTab === "fleet" && showColonyOperationalIntel ? (
          <>
            <dl className="grid gap-x-5 gap-y-2 text-xs sm:grid-cols-2 xl:grid-cols-3">
              <PlanetInfoRow
                label="Fleet size"
                value={`${formatWhole(fleetSize)} ${fleetSize === 1 ? "ship" : "ships"}`}
              />
              <PlanetInfoRow
                label="Defense advantage"
                value={`x${defenseAdvantage.toFixed(2)}${system.isHomeworld ? " homeworld" : ""}`}
              />
              <PlanetInfoRow
                label="Ship production effort"
                value={hasFoodEconomy ? `${Math.round(sliderShips)}%` : "N/A"}
              />
            </dl>
            <div className="mt-3 space-y-3">
              <div>
                <h4 className="text-st-muted">Fleets at planet</h4>
                {fleetsAtSystem.length === 0 ? (
                  <p className="mt-1 text-st-muted">None</p>
                ) : (
                  <ul className="mt-1 space-y-1">
                    {fleetsAtSystem.map((fleet) => {
                      const maySelectFleet =
                        onFleetCardTap !== undefined && fleetSelectionAllowed(fleet.empireId);
                      return (
                      <li key={fleet.id}>
                        <button
                          type="button"
                          className="w-full rounded border border-st-border/50 bg-st-panel/40 px-2 py-1 text-left transition-colors hover:border-cyan-500/45 hover:bg-st-panel/65 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-cyan-500 disabled:pointer-events-none disabled:opacity-50"
                          disabled={!maySelectFleet}
                          onClick={() => onFleetCardTap?.(fleet.id)}
                          title={
                            !maySelectFleet
                              ? "You can only select fleets from your own empire"
                              : "Show on map and select this fleet"
                          }
                        >
                          <div className="flex justify-between gap-2">
                            <span className="truncate text-st-fg">{fleet.name}</span>
                            <span className="shrink-0 font-mono text-st-fg">
                              {formatWhole(fleet.strength)}
                            </span>
                          </div>
                          <div className="mt-0.5 flex justify-between gap-2 text-[10px] text-st-muted">
                            <span className="truncate">
                              {empireNames[fleet.empireId] ?? "Unknown empire"}
                            </span>
                            <span className="capitalize">{fleet.status}</span>
                          </div>
                        </button>
                      </li>
                      );
                    })}
                  </ul>
                )}
              </div>

              {colonyShipsAtSystem.length > 0 ? (
                <div>
                  <h4 className="text-st-muted">Colony ships at planet</h4>
                  <ul className="mt-1 space-y-1">
                    {colonyShipsAtSystem.map((ship) => (
                      <li
                        key={ship.id}
                        className="rounded border border-teal-500/25 bg-teal-950/10 px-2 py-1"
                      >
                        <div className="flex justify-between gap-2">
                          <span className="truncate text-st-fg">{ship.name}</span>
                          <span className="shrink-0 capitalize text-teal-200/90">{ship.status}</span>
                        </div>
                        <div className="mt-0.5 flex justify-between gap-2 text-[10px] text-st-muted">
                          <span className="truncate">
                            {empireNames[ship.empireId] ?? "Unknown empire"}
                          </span>
                          <span>
                            Damage {formatWhole(ship.mothershipDefenseDamage ?? 0)}
                          </span>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          </>
        ) : null}

        {planetPanelTab === "battle" ? (
          <div>
            <h4 className="text-st-muted">Last battle</h4>
            {recentCombat === undefined ? (
              <p className="mt-1 text-st-muted">Loading...</p>
            ) : recentCombat === null ? (
              <p className="mt-1 text-st-muted">None</p>
            ) : (
              <div className="mt-1 rounded border border-red-500/25 bg-red-950/10 px-2 py-1 text-st-fg">
                <div className="flex justify-between gap-2">
                  <span>Turns</span>
                  <span className="font-mono">
                    T{recentCombat.startedTurn} -{" "}
                    {recentCombat.endedTurn === null ? "active" : `T${recentCombat.endedTurn}`}
                  </span>
                </div>
                <div className="mt-0.5 flex justify-between gap-2">
                  <span>Ships destroyed</span>
                  <span className="font-mono">
                    A {formatWhole(recentCombat.attackerShipsDestroyed ?? 0)} / D{" "}
                    {formatWhole(recentCombat.defenderShipsDestroyed ?? 0)}
                  </span>
                </div>
                <div className="mt-0.5">
                  <div className="flex justify-between gap-2">
                    <span>Damage</span>
                    <span className="font-mono">{formatWhole(recentCombatTotalDamage)}</span>
                  </div>
                  <p className="mt-0.5 text-[10px] leading-snug text-st-muted">
                    {recentCombatDamageParts.length === 0
                      ? "No collateral damage recorded"
                      : recentCombatDamageParts.join(" · ")}
                  </p>
                </div>
              </div>
            )}
          </div>
        ) : null}

        {planetPanelTab === "routes" ? (
          <section>
            <h4 className="text-st-muted">Hyperspace links</h4>
            <div className="mt-1 text-st-fg">
              {selectedNeighbors.length === 0 ? (
                <span className="text-st-muted">None</span>
              ) : (
                <ul className="list-inside list-disc space-y-0.5">
                  {selectedNeighbors.map((n) => (
                    <li key={n.id}>
                      <button
                        type="button"
                        className="text-left text-cyan-300/90 underline decoration-cyan-500/40 underline-offset-2 hover:text-cyan-200"
                        onClick={() => onNeighborNavigate(n.id)}
                      >
                        {n.name}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        ) : null}
      </div>

      {showHomeworldColonyUi || showColonizeInStarPanel || showIdleColonyNeighborAwayFromHomeworld ? (
        <div className="mt-3 space-y-2">
          {showHomeworldColonyUi ? (
            <div className="rounded border border-teal-500/35 bg-teal-950/25 px-2 py-2">
              <div className="text-[11px] font-medium text-teal-200/90">Colony ship project</div>
              <p className="mt-0.5 text-[10px] leading-snug text-st-muted">
                Diverts <span className="font-mono text-st-fg/90">ship production</span> from garrison ships.
                Target cost is about{" "}
                <span className="font-mono text-st-fg/90">{COLONY_SHIP_BUILD_TURNS} turns</span> of output at
                max ship effort on this homeworld. Dispatch costs{" "}
                <span className="font-mono text-st-fg/90">
                  {COLONY_SHIP_CARGO_DISPLAY.toLocaleString()}
                </span>{" "}
                people from this world.
              </p>
              {idleColonyDispatchAtHomeworld ? (
                <p className="mt-1 text-[10px] leading-snug text-teal-100/80">
                  Drag from the colony ship on the map to a linked star — same as fleets (teal dashed preview).
                  Further hops: dispatch again whenever the ship is idle at a colony.
                </p>
              ) : null}
              {idleColonyDispatchAtHomeworld ? (
                <div className="mt-2 space-y-1.5">
                  <p className="text-[11px] text-teal-100/90">Colony ship ready — dispatch to a neighbor.</p>
                  <p className="text-[10px] text-st-muted">
                    Costs {COLONY_SHIP_CARGO_DISPLAY.toLocaleString()} people from this homeworld.
                  </p>
                  {selectedNeighbors.length === 0 ? (
                    <p className="text-[10px] text-st-muted">No hyperspace links from this system.</p>
                  ) : (
                    <ul className="flex flex-col gap-1">
                      {selectedNeighbors.map((n) => (
                        <li key={n.id}>
                          <Button
                            type="button"
                            variant="secondary"
                            className="h-8 w-full justify-start text-xs"
                            disabled={colonyBusy}
                            onClick={() =>
                              void runColonyAction(() => onDispatchColonyFromStarPanel(n.id))
                            }
                          >
                            Dispatch to {n.name}
                          </Button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ) : colonyBuildInProgress && onCancelColonyBuild ? (
                <div className="mt-2 space-y-1">
                  <div className="flex justify-between text-[11px] text-st-muted">
                    <span>Build progress</span>
                    <span className="font-mono text-st-fg">
                      {buildProgress} / {buildCost} ship pts
                    </span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-st-border/80">
                    <div
                      className="h-full bg-teal-400/80 transition-[width]"
                      style={{
                        width: `${buildCost > 0 ? Math.min(100, (100 * buildProgress) / buildCost) : 0}%`,
                      }}
                    />
                  </div>
                  <Button
                    type="button"
                    variant="secondary"
                    className="mt-1 h-8 w-full text-xs"
                    disabled={colonyBusy}
                    onClick={() => void runColonyAction(onCancelColonyBuild)}
                  >
                    Pause / cancel build
                  </Button>
                </div>
              ) : onStartColonyBuild ? (
                <Button
                  type="button"
                  className="mt-2 h-8 w-full text-xs"
                  disabled={colonyBusy}
                  onClick={() => void runColonyAction(onStartColonyBuild)}
                >
                  Start colony ship build
                </Button>
              ) : null}
            </div>
          ) : null}
          {showIdleColonyNeighborAwayFromHomeworld ? (
            <div className="rounded border border-teal-500/35 bg-teal-950/20 px-2 py-2">
              <div className="text-[11px] font-medium text-teal-200/90">Idle colony ship</div>
              <p className="mt-0.5 text-[10px] leading-snug text-teal-100/80">
                Drag from the colony ship on the map to a linked star — same as fleets. Chain voyages by
                issuing another drag whenever the ship is idle at a colony.
              </p>
              <p className="mt-1 text-[10px] text-st-muted">
                Cargo already aboard — no population is deducted from this colony.
              </p>
              <div className="mt-2 space-y-1.5">
                <p className="text-[11px] text-teal-100/90">Dispatch to a neighbor</p>
                {selectedNeighbors.length === 0 ? (
                  <p className="text-[10px] text-st-muted">No hyperspace links from this system.</p>
                ) : (
                  <ul className="flex flex-col gap-1">
                    {selectedNeighbors.map((n) => (
                      <li key={n.id}>
                        <Button
                          type="button"
                          variant="secondary"
                          className="h-8 w-full justify-start text-xs"
                          disabled={colonyBusy}
                          onClick={() => void runColonyAction(() => onDispatchColonyFromStarPanel(n.id))}
                        >
                          Dispatch to {n.name}
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          ) : null}
          {showColonizeInStarPanel ? (
            <div className="rounded border border-emerald-500/35 bg-emerald-950/20 px-2 py-2">
              <div className="text-[11px] font-medium text-emerald-200/90">Recolonization</div>
              <p className="mt-0.5 text-[10px] leading-snug text-st-muted">
                Found a colony with {COLONY_SHIP_CARGO_DISPLAY.toLocaleString()} people, starter food
                stockpile, and{" "}
                <span className="font-mono text-st-fg/90">+{COLONY_NEW_WORLD_FOOD_BONUS_PER_TURN}</span> bonus
                food production per turn. The colony ship is consumed.
              </p>
              <Button
                type="button"
                className="mt-2 h-8 w-full text-xs"
                disabled={colonyBusy}
                onClick={() => void runColonyAction(onColonizeFromStarPanel)}
              >
                Colonize this system
              </Button>
            </div>
          ) : null}
          {colonyMutationError != null &&
          (showHomeworldColonyUi || showColonizeInStarPanel || showIdleColonyNeighborAwayFromHomeworld) ? (
            <p className="text-[10px] text-red-400">{colonyMutationError}</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
