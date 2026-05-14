import { useMemo } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { Card } from "@/components/ui/card";
import { useGalaxyMapNav } from "@/features/galaxy/context/GalaxyMapNavContext";
import { useActiveGame } from "@/features/galaxy/hooks/useActiveGame";
import { formatPopulationPeople } from "@/lib/populationFormat";

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
      <h3 className="text-xs font-semibold uppercase tracking-wide text-st-muted">
        Strategic posture
      </h3>
      <p className="text-[11px] text-st-muted">
        Manual five-level overrides on top of your scripted automation. The badge shows whether
        an axis follows the strategy default or your override. Picking the strategy default level
        clears the override for that axis.
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
                        void patchSlider({ gameId: props.gameId, key, level: null });
                      } else {
                        void patchSlider({ gameId: props.gameId, key, level });
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

function resolveHomeworldSystemId(
  empire: { _id: Id<"emp_states">; homeSystemId: Id<"gal_systems"> | null },
  systems: {
    _id: Id<"gal_systems">;
    ownerEmpireId: Id<"emp_states"> | null;
    isHomeworld: boolean;
  }[],
): Id<"gal_systems"> | null {
  if (empire.homeSystemId !== null) return empire.homeSystemId;
  const homeworld = systems.find(
    (s) => s.ownerEmpireId === empire._id && s.isHomeworld,
  );
  if (homeworld !== undefined) return homeworld._id;
  const anyOwned = systems.find((s) => s.ownerEmpireId === empire._id);
  return anyOwned?._id ?? null;
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
  controller?: "human" | "npc";
  playerName?: string;
  insolvencyTurns?: number;
  isCollapsed: boolean;
};

function EmpireSnapshotListRow(props: {
  empire: EmpireSnapshotDoc;
  starsOwned: number;
  homeworldId: Id<"gal_systems"> | null;
  requestEmpireHomeworldFocus?: (empireId: Id<"emp_states">) => void;
  showCredits: boolean;
}) {
  const { empire, starsOwned, homeworldId, requestEmpireHomeworldFocus, showCredits } = props;
  const canFocusHomeworld = requestEmpireHomeworldFocus !== undefined && homeworldId !== null;

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
              className="block max-w-[11rem] text-left font-medium text-cyan-200/95 underline decoration-cyan-500/40 decoration-dotted underline-offset-2 hover:text-cyan-100 hover:decoration-cyan-300/70"
              title={`${empire.name} — pan map to homeworld`}
              onClick={() => requestEmpireHomeworldFocus?.(empire._id)}
            >
              {formatEmpireSnapshotName(empire.name)}
            </button>
          ) : (
            <span className="block font-medium text-st-fg" title={empire.name}>
              {formatEmpireSnapshotName(empire.name)}
            </span>
          )}
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

export function EmpirePanel(props: { focusEmpireId?: Id<"emp_states"> | null }) {
  const focusEmpireId = props.focusEmpireId ?? null;
  const { activeGame } = useActiveGame();
  const galaxyMapNav = useGalaxyMapNav();
  const requestEmpireHomeworldFocus = galaxyMapNav?.requestEmpireHomeworldFocus;
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

  type EmpireRow = (typeof empires)[number];

  const { snapshotEmpire, otherHumanEmpires, npcEmpires } = useMemo(() => {
    if (focusEmpireId === null) {
      return {
        snapshotEmpire: null as EmpireRow | null,
        otherHumanEmpires: [] as EmpireRow[],
        npcEmpires: [] as EmpireRow[],
      };
    }
    const mine = empires.find((e) => e._id === focusEmpireId) ?? null;
    const rest = empires.filter((e) => e._id !== focusEmpireId);
    const humans = rest.filter((e) => e.controller !== "npc");
    const npcs = rest.filter((e) => e.controller === "npc");
    const byName = (a: EmpireRow, b: EmpireRow) => a.name.localeCompare(b.name);
    return {
      snapshotEmpire: mine,
      otherHumanEmpires: [...humans].sort(byName),
      npcEmpires: [...npcs].sort(byName),
    };
  }, [empires, focusEmpireId]);

  const hasRivalSection =
    focusEmpireId !== null && (otherHumanEmpires.length > 0 || npcEmpires.length > 0);
  return (
    <Card>
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
        {focusEmpireId === null ? (
          <>
            <dt className="text-st-muted">Systems</dt>
            <dd className="text-right">{systems.length}</dd>
            <dt className="text-st-muted">Empires</dt>
            <dd className="text-right">{empires.length}</dd>
          </>
        ) : (
          <>
            <dt className="text-st-muted">Your empire</dt>
            <dd className="truncate text-right text-st-fg" title={snapshotEmpire?.name ?? ""}>
              {snapshotEmpire?.name ?? "—"}
            </dd>
            <dt className="text-st-muted">Stars held</dt>
            <dd className="text-right">
              {snapshotEmpire === null
                ? "—"
                : systems.filter((s) => s.ownerEmpireId === snapshotEmpire._id).length}
            </dd>
          </>
        )}
      </dl>
      {focusEmpireId !== null && empires.length > 0 && snapshotEmpire === null ? (
        <p className="mt-3 text-xs text-amber-300/90">
          This game has no empire matching your assigned faction. Check the active game or seed.
        </p>
      ) : null}
      {focusEmpireId !== null &&
      (snapshotEmpire !== null || otherHumanEmpires.length > 0 || npcEmpires.length > 0) ? (
        <div className="mt-3 space-y-2 border-t border-st-border pt-3 text-xs">
          {snapshotEmpire !== null ? (
            <ul className="space-y-2">
              <EmpireSnapshotListRow
                empire={snapshotEmpire}
                starsOwned={systems.filter((s) => s.ownerEmpireId === snapshotEmpire._id).length}
                homeworldId={resolveHomeworldSystemId(snapshotEmpire, systems)}
                requestEmpireHomeworldFocus={requestEmpireHomeworldFocus}
                showCredits={true}
              />
            </ul>
          ) : null}
          {hasRivalSection ? (
            <>
              {snapshotEmpire !== null ? <div className="border-t border-st-border" /> : null}
              {otherHumanEmpires.length > 0 ? (
                <ul className="space-y-2">
                  {otherHumanEmpires.map((empire) => (
                    <EmpireSnapshotListRow
                      key={empire._id}
                      empire={empire}
                      starsOwned={systems.filter((s) => s.ownerEmpireId === empire._id).length}
                      homeworldId={resolveHomeworldSystemId(empire, systems)}
                      requestEmpireHomeworldFocus={requestEmpireHomeworldFocus}
                      showCredits={false}
                    />
                  ))}
                </ul>
              ) : null}
              {npcEmpires.length > 0 ? (
                <ul className={`space-y-2 ${otherHumanEmpires.length > 0 ? "mt-2" : ""}`}>
                  {npcEmpires.map((empire) => (
                    <EmpireSnapshotListRow
                      key={empire._id}
                      empire={empire}
                      starsOwned={systems.filter((s) => s.ownerEmpireId === empire._id).length}
                      homeworldId={resolveHomeworldSystemId(empire, systems)}
                      requestEmpireHomeworldFocus={requestEmpireHomeworldFocus}
                      showCredits={false}
                    />
                  ))}
                </ul>
              ) : null}
            </>
          ) : null}
        </div>
      ) : focusEmpireId === null && empires.length > 0 ? (
        <ul className="mt-3 space-y-2 border-t border-st-border pt-3 text-xs">
          {empires.map((empire) => (
            <EmpireSnapshotListRow
              key={empire._id}
              empire={empire}
              starsOwned={systems.filter((s) => s.ownerEmpireId === empire._id).length}
              homeworldId={resolveHomeworldSystemId(empire, systems)}
              requestEmpireHomeworldFocus={requestEmpireHomeworldFocus}
              showCredits={true}
            />
          ))}
        </ul>
      ) : null}
      {activeGame !== null ? (
        <StrategicSlidersBlock gameId={activeGame._id} />
      ) : null}
    </Card>
  );
}
