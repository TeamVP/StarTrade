import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { Repeat2 } from "lucide-react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useGalaxyMapNav } from "@/features/galaxy/context/GalaxyMapNavContext";
import { useActiveGame } from "@/features/galaxy/hooks/useActiveGame";
import { formatPopulationPeople } from "@/lib/populationFormat";
import { getTurnElapsedFraction } from "@/lib/time/turnClock";
import { useTurnClock } from "@/lib/time/useTurnClock";

const STRATEGIC_LEVEL_ORDER = [
  "lowest",
  "low",
  "medium",
  "high",
  "highest",
] as const;

type StrategicSliderKey =
  | "militaryAggression"
  | "expansion"
  | "defensivePosture"
  | "priorityOperations"
  | "economicMobilization";

const STRATEGIC_SLIDER_KEYS: StrategicSliderKey[] = [
  "militaryAggression",
  "expansion",
  "defensivePosture",
  "priorityOperations",
  "economicMobilization",
];

const STRATEGIC_SLIDER_LABEL_FALLBACKS: Record<StrategicSliderKey, string> = {
  militaryAggression: "Military aggression",
  expansion: "Expansion & colonization",
  defensivePosture: "Defense & reinforcement",
  priorityOperations: "Priority star operations",
  economicMobilization: "Economic mobilization",
};

function formatLevelShort(level: string): string {
  return level.charAt(0).toUpperCase() + level.slice(1);
}

function StrategicSlidersBlock(props: { gameId: Id<"sim_games"> }) {
  const data = useQuery(api.emp.queries.getMyStrategicSliders, {
    gameId: props.gameId,
  });
  const patchSlider = useMutation(api.emp.mutations.patchStrategicSlider);

  if (data === undefined) {
    return (
      <p className="mt-3 border-t border-st-border pt-3 text-xs text-st-muted">
        Loading strategic posture…
      </p>
    );
  }

  if (data === null) {
    return null;
  }

  if (data.effective == null || data.defaults == null) {
    return (
      <p className="mt-3 border-t border-st-border pt-3 text-xs text-st-muted">
        Strategic posture requires automation strategy JSON on your empire.
      </p>
    );
  }

  const labels = data.labels ?? STRATEGIC_SLIDER_LABEL_FALLBACKS;

  return (
    <div className="mt-3 space-y-3 border-t border-st-border pt-3">
      <p className="text-[11px] text-st-muted">
        Override your strategy&apos;s default settings.
        {data.runtimeVersion === "v2_game_actor" && data.actorSlotNumber !== null
          ? ` Controls Actor ${data.actorSlotNumber}${data.actorDisplayName !== null ? ` (${data.actorDisplayName})` : data.actorLabel !== null ? ` (${data.actorLabel})` : ""}.`
          : ""}
      </p>
      {STRATEGIC_SLIDER_KEYS.map((key) => {
        const defaultLevel = data.defaults[key];
        const effectiveLevel = data.effective[key];
        const isOverride = data.overrides?.[key] !== undefined;
        return (
          <div key={key} className="space-y-1">
            <div className="flex items-start justify-between gap-2">
              <span className="text-[11px] font-medium text-st-fg">
                {labels[key] ?? STRATEGIC_SLIDER_LABEL_FALLBACKS[key]}
              </span>
              {isOverride ? (
                <span className="shrink-0 text-[10px] text-amber-200/90">Override</span>
              ) : (
                <span className="shrink-0 text-[10px] text-st-muted">Default</span>
              )}
            </div>
            <div className="flex flex-wrap gap-1">
              {STRATEGIC_LEVEL_ORDER.map((level) => {
                const selected = effectiveLevel === level;
                return (
                  <button
                    key={level}
                    type="button"
                    title={`Strategy default: ${formatLevelShort(defaultLevel)}`}
                    className={
                      selected
                        ? "rounded border border-cyan-500/60 bg-cyan-950/50 px-1.5 py-0.5 text-[10px] text-cyan-100"
                        : "rounded border border-st-border/70 bg-st-bg/40 px-1.5 py-0.5 text-[10px] text-st-muted hover:border-st-border hover:text-st-fg"
                    }
                    onClick={() => {
                      if (level === defaultLevel) {
                        void patchSlider({
                          gameId: props.gameId,
                          gameActorId: data.actorId ?? undefined,
                          key,
                          level: null,
                        });
                      } else {
                        void patchSlider({
                          gameId: props.gameId,
                          gameActorId: data.actorId ?? undefined,
                          key,
                          level,
                        });
                      }
                    }}
                  >
                    {formatLevelShort(level)}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

type AutomationProfileRow = {
  _id: Id<"usr_automation_profiles">;
  name: string;
  isActive?: boolean;
  strategyJson: string;
};

type EmpireAutomationState = {
  empireId: Id<"emp_states">;
  empireKey: string;
  empireName: string;
  strategyJson: string | null;
  standingOrdersRefreshRequestedAt: number | null;
};

function mutationErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/^[\s\S]*?Error:\s*/g, "").trim();
}

function EmpireAutomationPicker(props: { gameId: Id<"sim_games"> }) {
  const profilesQuery = useQuery(api.usr.queries.listMyAutomationProfiles, {});
  const empireAutomationQuery = useQuery(api.usr.queries.getMyEmpireAutomationStrategy, {
    gameId: props.gameId,
  });
  const applyAutomationProfileToMyEmpire = useMutation(
    api.usr.mutations.applyAutomationProfileToMyEmpire,
  );
  const clearMyEmpireAutomationStrategy = useMutation(
    api.usr.mutations.clearMyEmpireAutomationStrategy,
  );
  const queueMyEmpireStandingOrdersRefresh = useMutation(
    api.usr.mutations.queueMyEmpireStandingOrdersRefresh,
  );

  const [selectedValue, setSelectedValue] = useState("manual");
  const [selectionBusy, setSelectionBusy] = useState(false);
  const [rerunBusy, setRerunBusy] = useState(false);
  const [showStrategyOptions, setShowStrategyOptions] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const activeProfiles = useMemo(
    () =>
      ((profilesQuery ?? []) as AutomationProfileRow[]).filter((profile) => profile.isActive ?? true),
    [profilesQuery],
  );
  const empireAutomation = (empireAutomationQuery ?? null) as EmpireAutomationState | null;

  const derivedSelectionValue = useMemo(() => {
    if (empireAutomation === null || empireAutomation.strategyJson === null) {
      return "manual";
    }
    const matchedProfile = activeProfiles.find(
      (profile) => profile.strategyJson === empireAutomation.strategyJson,
    );
    return matchedProfile?._id ?? "current-live";
  }, [activeProfiles, empireAutomation]);

  useEffect(() => {
    if (profilesQuery === undefined || empireAutomationQuery === undefined) {
      return;
    }
    setSelectedValue(derivedSelectionValue);
  }, [derivedSelectionValue, empireAutomationQuery, profilesQuery]);

  if (profilesQuery === undefined || empireAutomationQuery === undefined) {
    return (
      <div className="mt-3 border-t border-st-border pt-3 text-xs text-st-muted">
        Loading strategy controls…
      </div>
    );
  }

  if (empireAutomation === null) {
    return null;
  }

  async function handleSelectionChange(nextValue: string) {
    if (nextValue === selectedValue || nextValue === "current-live") {
      return;
    }

    setSelectedValue(nextValue);
    setSelectionBusy(true);
    setStatus(null);
    setError(null);
    try {
      if (nextValue === "manual") {
        await clearMyEmpireAutomationStrategy({ gameId: props.gameId });
        setStatus("Manual mode selected. Existing standing orders stay until you rerun them.");
      } else {
        await applyAutomationProfileToMyEmpire({
          gameId: props.gameId,
          profileId: nextValue as Id<"usr_automation_profiles">,
        });
        const profileName =
          activeProfiles.find((profile) => profile._id === nextValue)?.name ?? "strategy";
        setStatus(`${profileName} is now your active empire strategy.`);
      }
    } catch (selectionError) {
      setSelectedValue(derivedSelectionValue);
      setError(mutationErrorMessage(selectionError));
    } finally {
      setSelectionBusy(false);
    }
  }

  async function handleQueueRefresh() {
    setRerunBusy(true);
    setStatus(null);
    setError(null);
    try {
      const result = await queueMyEmpireStandingOrdersRefresh({ gameId: props.gameId });
      setStatus(
        result.turnResolving
          ? "Standing-order reset queued. It will apply after the current turn finishes resolving."
          : "Standing orders cleared and queued to rebuild from the selected strategy on the next planning pass.",
      );
    } catch (queueError) {
      setError(mutationErrorMessage(queueError));
    } finally {
      setRerunBusy(false);
    }
  }

  const hasUnmatchedLiveStrategy = derivedSelectionValue === "current-live";

  return (
    <div className="mt-3 space-y-2 border-t border-st-border pt-3">
      <div className="flex items-center gap-2">
        <label className="min-w-0 flex-1 space-y-1 text-xs text-st-muted">
          <span className="block font-semibold uppercase tracking-wide">Standing orders strategy</span>
          <select
            value={selectedValue}
            disabled={selectionBusy || rerunBusy}
            onChange={(event) => {
              void handleSelectionChange(event.target.value);
            }}
            className="w-full rounded-md border border-st-border bg-st-panel px-3 py-2 text-sm text-st-fg outline-none focus:border-st-accent"
          >
            <option value="manual">Manual</option>
            {hasUnmatchedLiveStrategy ? (
              <option value="current-live">Current live strategy (not in active roster)</option>
            ) : null}
            {activeProfiles.map((profile) => (
              <option key={profile._id} value={profile._id}>
                {profile.name}
              </option>
            ))}
          </select>
        </label>
        <Button
          type="button"
          variant="secondary"
          className="mt-5 size-10 shrink-0 px-0"
          disabled={selectionBusy || rerunBusy}
          title="Clear this empire's standing orders and rebuild from the selected strategy when planning runs next"
          aria-label="Rerun standing orders from selected strategy"
          onClick={() => {
            void handleQueueRefresh();
          }}
        >
          <Repeat2 className="size-4" aria-hidden />
        </Button>
      </div>
      {showStrategyOptions ? <StrategicSlidersBlock gameId={props.gameId} /> : null}
      <button
        type="button"
        className="w-fit text-[11px] text-cyan-200/95 underline decoration-cyan-500/40 underline-offset-2 hover:text-cyan-100 hover:decoration-cyan-300/70"
        onClick={() => {
          setShowStrategyOptions((current) => !current);
        }}
      >
        {showStrategyOptions ? "Hide strategy options" : "Customise"}
      </button>
      {activeProfiles.length === 0 ? (
        <p className="text-[11px] text-amber-200/90">
          No active strategy profiles are in your roster right now, so only Manual is available here.
        </p>
      ) : null}
      {empireAutomation.standingOrdersRefreshRequestedAt !== null ? (
        <p className="text-[11px] text-cyan-200/90">
          A standing-order reset is already queued for this empire.
        </p>
      ) : null}
      {status !== null ? <p className="text-[11px] text-emerald-300">{status}</p> : null}
      {error !== null ? <p className="text-[11px] text-red-300">{error}</p> : null}
    </div>
  );
}

function resolveHomeworldSystemId(
  empire: {
    _id: Id<"emp_states">;
    homeSystemId: Id<"gal_systems"> | null;
    runtimeVersion?: "v1_empire" | "v2_game_actor";
    actorId?: Id<"sim_game_actors"> | null;
  },
  systems: {
    _id: Id<"gal_systems">;
    name: string;
    ownerEmpireId: Id<"emp_states"> | null;
    runtimeVersion?: "v1_empire" | "v2_game_actor";
    ownerActorId?: Id<"sim_game_actors"> | null;
    isHomeworld: boolean;
  }[],
): Id<"gal_systems"> | null {
  if (empire.homeSystemId !== null) return empire.homeSystemId;
  const matchesOwnership = (system: (typeof systems)[number]) => {
    if (
      empire.runtimeVersion === "v2_game_actor" &&
      empire.actorId !== null &&
      empire.actorId !== undefined &&
      system.runtimeVersion === "v2_game_actor" &&
      system.ownerActorId !== null &&
      system.ownerActorId !== undefined
    ) {
      return system.ownerActorId === empire.actorId;
    }
    return system.ownerEmpireId === empire._id;
  };
  const homeworld = systems.find(
    (s) => matchesOwnership(s) && s.isHomeworld,
  );
  if (homeworld !== undefined) return homeworld._id;
  const anyOwned = systems.find((s) => matchesOwnership(s));
  return anyOwned?._id ?? null;
}

function resolveEmpireDisplayLabel(empire: EmpireSnapshotDoc): string {
  if (empire.runtimeVersion === "v2_game_actor" && empire.actorSlotNumber !== null) {
    const actorName = empire.actorDisplayName ?? empire.actorLabel ?? empire.name;
    return `Actor ${empire.actorSlotNumber}${actorName.length > 0 ? ` · ${actorName}` : ""}`;
  }
  return empire.name;
}

/** Empire Snapshot: names longer than 18 chars show 15 chars plus an ellipsis. */
function formatEmpireSnapshotName(name: string): string {
  return name.length > 18 ? `${name.slice(0, 15)}...` : name;
}

function formatTreasuryCompact(value: number): string {
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value);

  if (abs < 1_000) return `${sign}${Math.round(abs)}`;
  if (abs < 10_000) return `${sign}${(abs / 1_000).toFixed(1)}k`;
  if (abs < 1_000_000) return `${sign}${Math.round(abs / 1_000)}k`;
  if (abs < 10_000_000) return `${sign}${(abs / 1_000_000).toFixed(1)} mill`;
  if (abs < 1_000_000_000) return `${sign}${Math.round(abs / 1_000_000)} mill`;
  if (abs < 1_000_000_000_000) return `${sign}${Math.round(abs / 1_000_000_000)}B`;
  return `${sign}${Math.round(abs / 1_000_000_000_000)}T`;
}

type EmpireSnapshotDoc = {
  _id: Id<"emp_states">;
  name: string;
  colorHex: string;
  treasury: number;
  population: number;
  runtimeVersion?: "v1_empire" | "v2_game_actor";
  actorId?: Id<"sim_game_actors"> | null;
  actorSlotNumber?: number | null;
  actorLabel?: string | null;
  actorDisplayName?: string | null;
  controller?: "human" | "npc";
  playerName?: string;
  insolvencyTurns?: number;
  isCollapsed: boolean;
};

function EmpireSnapshotListRow(props: {
  empire: EmpireSnapshotDoc;
  starsOwned: number;
  homeworldId: Id<"gal_systems"> | null;
  homeworldName: string | null;
  requestEmpireHomeworldFocus?: (empireId: Id<"emp_states">) => void;
  showCredits: boolean;
}) {
  const { empire, starsOwned, homeworldId, homeworldName, requestEmpireHomeworldFocus, showCredits } = props;
  const canFocusHomeworld = requestEmpireHomeworldFocus !== undefined && homeworldId !== null;
  const displayLabel = resolveEmpireDisplayLabel(empire);

  return (
    <li className="flex justify-between gap-2">
      <span className="flex items-center gap-2">
        <span
          className="inline-block size-2 rounded-full"
          style={{ backgroundColor: empire.colorHex }}
          aria-hidden
        />
        <span>
          {canFocusHomeworld ? (
            <button
              type="button"
              className="block max-w-44 text-left font-medium text-cyan-200/95 underline decoration-cyan-500/40 decoration-dotted underline-offset-2 hover:text-cyan-100 hover:decoration-cyan-300/70"
              title={`${displayLabel} — pan map to homeworld`}
              onClick={() => requestEmpireHomeworldFocus?.(empire._id)}
            >
              {formatEmpireSnapshotName(displayLabel)}
            </button>
          ) : (
            <span className="block font-medium text-st-fg" title={displayLabel}>
              {formatEmpireSnapshotName(displayLabel)}
            </span>
          )}
          {empire.runtimeVersion === "v2_game_actor" && empire.actorSlotNumber !== undefined && empire.actorSlotNumber !== null ? (
            <span className="block text-[11px] text-st-muted">
              Actor {empire.actorSlotNumber}
              {empire.actorDisplayName !== null && empire.actorDisplayName !== undefined
                ? ` · ${empire.actorDisplayName}`
                : ""}
            </span>
          ) : null}
          {homeworldName !== null ? (
            <span className="block text-[11px] text-st-muted">Homeworld: {homeworldName}</span>
          ) : null}
          {empire.playerName !== undefined ? (
            <span className="block text-[11px] text-st-muted">
              {empire.controller === "npc" ? "NPC" : "Player"}: {empire.playerName}
            </span>
          ) : null}
        </span>
      </span>
      <span className="text-st-muted">
        {showCredits ? (
          <>
            Credits {formatTreasuryCompact(empire.treasury)} · Pop{" "}
            {formatPopulationPeople(empire.population)}
            {` · Stars ${starsOwned}`}
            {(empire.insolvencyTurns ?? 0) > 0 ? ` · Debt ${empire.insolvencyTurns}t` : ""}
            {empire.isCollapsed ? " · Collapsed" : ""}
          </>
        ) : (
          <>
            Pop {formatPopulationPeople(empire.population)}
            {` · Stars ${starsOwned}`}
            {empire.isCollapsed ? " · Collapsed" : ""}
          </>
        )}
      </span>
    </li>
  );
}

export function EmpirePanel(props: {
  focusEmpireId?: Id<"emp_states"> | null;
  focusActorId?: Id<"sim_game_actors"> | null;
}) {
  const focusEmpireId = props.focusEmpireId ?? null;
  const focusActorId = props.focusActorId ?? null;
  const hasFocusTarget = focusEmpireId !== null || focusActorId !== null;
  const { activeGame, setSelectedGameId } = useActiveGame();
  const galaxyMapNav = useGalaxyMapNav();
  const requestEmpireHomeworldFocus = galaxyMapNav?.requestEmpireHomeworldFocus;
  const myMembership = useQuery(
    api.usr.queries.getMyGameMembership,
    activeGame ? { gameId: activeGame._id } : "skip",
  );
  const resignFromGame = useMutation(api.usr.mutations.resignFromGame);
  const resetMyStarterGame = useMutation(api.usr.mutations.resetMyStarterGame);
  const pauseGame = useMutation(api.sim.mutations.pauseGame);
  const resumeGame = useMutation(api.sim.mutations.resumeGame);
  const systems =
    useQuery(
      api.gal.queries.listSystems,
      activeGame ? { gameId: activeGame._id, limit: 256 } : "skip",
    ) ?? [];
  const empiresRaw = useQuery(
    api.emp.queries.listEmpires,
    activeGame ? { gameId: activeGame._id, limit: 20 } : "skip",
  );
  const empires = useMemo(() => empiresRaw ?? [], [empiresRaw]);
  const [gameActionBusy, setGameActionBusy] = useState<"resign" | "new" | null>(null);
  const [gameActionError, setGameActionError] = useState<string | null>(null);
  const [pauseBusy, setPauseBusy] = useState(false);
  const [pauseError, setPauseError] = useState<string | null>(null);

  const turnPresentationPackage = useQuery(
    api.sim.queries.getTurnPresentationPackageForGame,
    activeGame ? { gameId: activeGame._id } : "skip",
  );
  const turnTimeline = turnPresentationPackage?.timeline;

  const turnStartedAt = turnTimeline?.turnStartedAt ?? null;
  const turnDurationMs = turnTimeline?.turnDurationMs ?? null;
  const turnPausedAtMs = turnTimeline?.turnPausedAtMs ?? null;
  const gameStatus = turnTimeline?.gameStatus ?? activeGame?.status ?? null;
  const { alignedNowMs } = useTurnClock({
    gameStatus,
    turnPausedAtMs,
    serverNowMs: turnTimeline?.serverNowMs,
  });

  // Fraction elapsed in the current turn window [0..1]; visible during running AND paused.
  const turnElapsedFrac = useMemo(() => {
    if (!(turnTimeline?.isTurnClockActive ?? false)) return null;
    return getTurnElapsedFraction({
      turnStartedAtMs: turnStartedAt,
      turnDurationMs,
      nowMs: alignedNowMs,
      gameStatus,
      turnPausedAtMs,
    });
  }, [alignedNowMs, gameStatus, turnDurationMs, turnPausedAtMs, turnStartedAt, turnTimeline?.isTurnClockActive]);

  type EmpireRow = (typeof empires)[number];

  const ownedSystemCountByEmpireId = useMemo(() => {
    const counts = new Map<Id<"emp_states">, number>();
    for (const system of systems) {
      if (system.ownerEmpireId === null) continue;
      counts.set(system.ownerEmpireId, (counts.get(system.ownerEmpireId) ?? 0) + 1);
    }
    return counts;
  }, [systems]);
  const ownedSystemCountByActorId = useMemo(() => {
    const counts = new Map<Id<"sim_game_actors">, number>();
    for (const system of systems) {
      if (
        system.runtimeVersion !== "v2_game_actor" ||
        system.ownerActorId === null ||
        system.ownerActorId === undefined
      ) {
        continue;
      }
      counts.set(system.ownerActorId, (counts.get(system.ownerActorId) ?? 0) + 1);
    }
    return counts;
  }, [systems]);
  const systemNameById = useMemo(
    () => new Map(systems.map((system) => [system._id, system.name] as const)),
    [systems],
  );
  const getStarsOwned = (empire: EmpireRow) =>
    empire.runtimeVersion === "v2_game_actor" &&
    empire.actorId !== null &&
    empire.actorId !== undefined
      ? (ownedSystemCountByActorId.get(empire.actorId) ?? 0)
      : (ownedSystemCountByEmpireId.get(empire._id) ?? 0);

  const { snapshotEmpire, otherHumanEmpires, npcEmpires } = useMemo(() => {
    if (!hasFocusTarget) {
      return {
        snapshotEmpire: null as EmpireRow | null,
        otherHumanEmpires: [] as EmpireRow[],
        npcEmpires: [] as EmpireRow[],
      };
    }
    const mine =
      (focusActorId !== null
        ? empires.find((e) => e.actorId === focusActorId)
        : undefined) ??
      (focusEmpireId !== null ? empires.find((e) => e._id === focusEmpireId) : undefined) ??
      null;
    const rest = mine === null ? empires : empires.filter((e) => e._id !== mine._id);
    const humans = rest.filter((e) => e.controller !== "npc");
    const npcs = rest.filter((e) => e.controller === "npc");
    const byName = (a: EmpireRow, b: EmpireRow) => a.name.localeCompare(b.name);
    return {
      snapshotEmpire: mine,
      otherHumanEmpires: [...humans].sort(byName),
      npcEmpires: [...npcs].sort(byName),
    };
  }, [empires, focusActorId, focusEmpireId, hasFocusTarget]);

  const hasRivalSection =
    hasFocusTarget && (otherHumanEmpires.length > 0 || npcEmpires.length > 0);
  const snapshotStarsOwned =
    snapshotEmpire === null
      ? 0
      : getStarsOwned(snapshotEmpire);
  const snapshotHomeworldId =
    snapshotEmpire === null ? null : resolveHomeworldSystemId(snapshotEmpire, systems);
  const snapshotHomeworldName =
    snapshotHomeworldId === null ? null : (systemNameById.get(snapshotHomeworldId) ?? null);
  const canResignFromSnapshot =
    activeGame !== null &&
    snapshotEmpire !== null &&
    activeGame.status !== "finished" &&
    myMembership?.isEmpirePlayer === true &&
    ((myMembership.runtimeVersion === "v2_game_actor" &&
      myMembership.actorId !== null &&
      snapshotEmpire.actorId !== null &&
      snapshotEmpire.actorId !== undefined
        ? myMembership.actorId === snapshotEmpire.actorId
        : myMembership.empireId === snapshotEmpire._id));
  const canCreateNewStarterGame =
    activeGame !== null &&
    (activeGame.missionKey ?? activeGame.lobbyScenarioKey ?? null) !== null &&
    activeGame.status === "finished";
  const canPauseOrResume =
    activeGame !== null &&
    (turnTimeline?.acceptingOrders ?? false) &&
    (myMembership?.role === "empire" || myMembership?.role === "admin");

  async function onPauseToggle() {
    if (activeGame === null) return;
    setPauseBusy(true);
    setPauseError(null);
    try {
      if (activeGame.status === "running") {
        await pauseGame({ gameId: activeGame._id });
      } else if (activeGame.status === "paused") {
        await resumeGame({ gameId: activeGame._id });
      }
    } catch (error) {
      setPauseError(mutationErrorMessage(error));
    } finally {
      setPauseBusy(false);
    }
  }

  async function onResignFromSnapshot() {
    if (activeGame === null) return;
    if (
      !window.confirm(
        "Resign from this game? If no human players remain, the game will end immediately, write final results, and begin cleanup.",
      )
    ) {
      return;
    }
    setGameActionBusy("resign");
    setGameActionError(null);
    try {
      await resignFromGame({ gameId: activeGame._id });
    } catch (error) {
      setGameActionError(mutationErrorMessage(error));
    } finally {
      setGameActionBusy(null);
    }
  }

  async function onStartNewStarterGame() {
    const missionKey = activeGame?.missionKey ?? activeGame?.lobbyScenarioKey ?? null;
    if (missionKey === null) {
      return;
    }
    setGameActionBusy("new");
    setGameActionError(null);
    try {
      const result = await resetMyStarterGame({ scenarioKey: missionKey });
      setSelectedGameId(result.gameId as Id<"sim_games">);
    } catch (error) {
      setGameActionError(mutationErrorMessage(error));
    } finally {
      setGameActionBusy(null);
    }
  }

  return (
    <Card>
      {canPauseOrResume ? (
        <div className="mb-3 border-b border-st-border pb-3">
          <Button
            type="button"
            variant="secondary"
            className="relative w-full overflow-hidden"
            disabled={pauseBusy}
            onClick={() => {
              void onPauseToggle();
            }}
          >
            {/* Countdown bar: full at turn start, left edge sweeps rightward as the turn elapses.
                Anchored to the button's right edge; frozen (animation paused) when game is paused. */}
            {turnElapsedFrac !== null ? (
              <span
                aria-hidden
                className="pointer-events-none absolute inset-y-0 right-0 st-turn-countdown-bg"
                style={{
                  width: `${Math.round((1 - turnElapsedFrac) * 100)}%`,
                  transition: "width 0.25s linear",
                  opacity: 0.72,
                  animationPlayState: gameStatus === "paused" ? "paused" : "running",
                }}
              />
            ) : null}
            <span className="relative z-10">
              {pauseBusy
                ? "Updating..."
                : activeGame?.status === "paused"
                  ? "Play game"
                  : "Pause game"}
            </span>
          </Button>
          {pauseError !== null ? (
            <p className="mt-2 text-xs text-red-300" role="alert">
              {pauseError}
            </p>
          ) : null}
        </div>
      ) : null}
      <h2 className="text-sm font-semibold uppercase tracking-wide text-st-muted">
        Empire Snapshot
      </h2>
      <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
        <dt className="text-st-muted">Active Game</dt>
        <dd className="text-right">{activeGame?.name ?? "None"}</dd>
        <dt className="text-st-muted">Status</dt>
        <dd className="text-right capitalize">{activeGame?.status ?? "—"}</dd>
        <dt className="text-st-muted">Turn</dt>
        <dd className="text-right">{activeGame?.currentTurn ?? "—"}</dd>
        {!hasFocusTarget ? (
          <>
            <dt className="text-st-muted">Systems</dt>
            <dd className="text-right">{systems.length}</dd>
            <dt className="text-st-muted">Empires</dt>
            <dd className="text-right">{empires.length}</dd>
          </>
        ) : (
          <>
            <dt className="text-st-muted">Your empire</dt>
            <dt className="text-st-muted">
              {snapshotEmpire?.runtimeVersion === "v2_game_actor" ? "Your actor" : "Your empire"}
            </dt>
            <dd
              className="truncate text-right text-st-fg"
              title={snapshotEmpire !== null ? resolveEmpireDisplayLabel(snapshotEmpire) : ""}
            >
              {snapshotEmpire !== null ? resolveEmpireDisplayLabel(snapshotEmpire) : "—"}
            </dd>
            <dt className="text-st-muted">Stars held</dt>
            <dd className="text-right">
              {snapshotEmpire === null ? "—" : snapshotStarsOwned}
            </dd>
            <dt className="text-st-muted">Homeworld</dt>
            <dd className="truncate text-right">{snapshotHomeworldName ?? "—"}</dd>
          </>
        )}
      </dl>
      {hasFocusTarget && empires.length > 0 && snapshotEmpire === null ? (
        <p className="mt-3 text-xs text-amber-300/90">
          This game has no empire matching your assigned faction. Check the active game or seed.
        </p>
      ) : null}
      {activeGame !== null && snapshotEmpire !== null ? (
        <EmpireAutomationPicker gameId={activeGame._id} />
      ) : null}
      {hasFocusTarget &&
      (snapshotEmpire !== null || otherHumanEmpires.length > 0 || npcEmpires.length > 0) ? (
        <div className="mt-3 space-y-2 border-t border-st-border pt-3 text-xs">
          {snapshotEmpire !== null ? (
            <ul className="space-y-2">
              <EmpireSnapshotListRow
                empire={snapshotEmpire}
                starsOwned={snapshotStarsOwned}
                homeworldId={snapshotHomeworldId}
                homeworldName={snapshotHomeworldName}
                requestEmpireHomeworldFocus={requestEmpireHomeworldFocus}
                showCredits={true}
              />
              {canResignFromSnapshot || canCreateNewStarterGame ? (
                <li className="flex flex-wrap justify-end gap-2 pt-1">
                  {canCreateNewStarterGame ? (
                    <Button
                      type="button"
                      disabled={gameActionBusy !== null}
                      onClick={() => {
                        void onStartNewStarterGame();
                      }}
                    >
                      {gameActionBusy === "new" ? "Working..." : "New game"}
                    </Button>
                  ) : null}
                  {canResignFromSnapshot ? (
                    <Button
                      type="button"
                      variant="secondary"
                      className="border border-orange-500/40 text-orange-700 hover:border-orange-500/70 hover:text-orange-800 dark:text-orange-300 dark:hover:text-orange-200"
                      disabled={gameActionBusy !== null}
                      onClick={() => {
                        void onResignFromSnapshot();
                      }}
                    >
                      {gameActionBusy === "resign" ? "Resigning..." : "Resign"}
                    </Button>
                  ) : null}
                </li>
              ) : null}
            </ul>
          ) : null}
          {gameActionError !== null ? (
            <p className="text-[11px] text-red-300" role="alert">
              {gameActionError}
            </p>
          ) : null}
          {hasRivalSection ? (
            <>
              {snapshotEmpire !== null ? <div className="border-t border-st-border" /> : null}
              {otherHumanEmpires.length > 0 ? (
                <ul className="space-y-2">
                  {otherHumanEmpires.map((empire) => {
                    const homeworldId = resolveHomeworldSystemId(empire, systems);
                    const homeworldName =
                      homeworldId === null ? null : (systemNameById.get(homeworldId) ?? null);
                    return (
                      <EmpireSnapshotListRow
                        key={empire._id}
                        empire={empire}
                        starsOwned={getStarsOwned(empire)}
                        homeworldId={homeworldId}
                        homeworldName={homeworldName}
                        requestEmpireHomeworldFocus={requestEmpireHomeworldFocus}
                        showCredits={false}
                      />
                    );
                  })}
                </ul>
              ) : null}
              {npcEmpires.length > 0 ? (
                <ul className={`space-y-2 ${otherHumanEmpires.length > 0 ? "mt-2" : ""}`}>
                  {npcEmpires.map((empire) => {
                    const homeworldId = resolveHomeworldSystemId(empire, systems);
                    const homeworldName =
                      homeworldId === null ? null : (systemNameById.get(homeworldId) ?? null);
                    return (
                      <EmpireSnapshotListRow
                        key={empire._id}
                        empire={empire}
                        starsOwned={getStarsOwned(empire)}
                        homeworldId={homeworldId}
                        homeworldName={homeworldName}
                        requestEmpireHomeworldFocus={requestEmpireHomeworldFocus}
                        showCredits={false}
                      />
                    );
                  })}
                </ul>
              ) : null}
            </>
          ) : null}
        </div>
      ) : !hasFocusTarget && empires.length > 0 ? (
        <ul className="mt-3 space-y-2 border-t border-st-border pt-3 text-xs">
          {empires.map((empire) => {
            const homeworldId = resolveHomeworldSystemId(empire, systems);
            const homeworldName =
              homeworldId === null ? null : (systemNameById.get(homeworldId) ?? null);
            return (
              <EmpireSnapshotListRow
                key={empire._id}
                empire={empire}
                starsOwned={getStarsOwned(empire)}
                homeworldId={homeworldId}
                homeworldName={homeworldName}
                requestEmpireHomeworldFocus={requestEmpireHomeworldFocus}
                showCredits={true}
              />
            );
          })}
        </ul>
      ) : null}
    </Card>
  );
}
