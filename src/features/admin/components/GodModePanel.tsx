import { startTransition, useState, useEffect } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { Button } from "@/components/ui/button";

type Settings = {
  foodProdMult: number;
  shipProdMult: number;
  popGrowthMult: number;
  taxMult: number;
  foodPriceElasticityMult: number;
  starvationMult: number;
  starvationFoodPriceCapMult: number;
  traderShipCostMult: number;
  combatAttackMult: number;
  combatDefendMult: number;
  collateralDamageMult: number;
  // Balance page fields — managed via /balance, preserved here on GodMode saves
  traderMinActive: number;
  traderMaxActive: number;
  traderShipHirePerTurn: number;
  traderHireChancePct: number;
  traderDockingCost: number;
  foodStockpileMaxPerPop: number;
  foodStockpileMinPerPop: number;
  foodStressFactor: number;
  combatDefenderAdvantage: number;
  foodBasePrice: number;
  combatFoodDamageMult: number;
  traderLimitsAutomated: boolean;
};

const DEFAULTS: Settings = {
  foodProdMult: 1,
  shipProdMult: 1,
  popGrowthMult: 1,
  taxMult: 1,
  foodPriceElasticityMult: 1,
  starvationMult: 1,
  starvationFoodPriceCapMult: 100,
  traderShipCostMult: 1,
  combatAttackMult: 1,
  combatDefendMult: 1,
  collateralDamageMult: 1,
  traderMinActive: 0,
  traderMaxActive: 3,
  traderShipHirePerTurn: 250,
  traderHireChancePct: 20,
  traderDockingCost: 100,
  foodStockpileMaxPerPop: 20.0,
  foodStockpileMinPerPop: 1.5,
  foodStressFactor: 1.0,
  combatDefenderAdvantage: 2.0,
  foodBasePrice: 6,
  combatFoodDamageMult: 1.0,
  traderLimitsAutomated: true,
};

type SliderSpec = {
  key: keyof Settings;
  label: string;
  min: number;
  max: number;
  step: number;
  description: string;
  /** Defaults / reset target for this slider (most knobs use 1×). */
  baseline?: number;
  formatValue?: (v: number) => string;
};

const ECONOMY_SLIDERS: SliderSpec[] = [
  {
    key: "foodProdMult",
    label: "Food Production",
    min: 0.1,
    max: 4,
    step: 0.05,
    description: "Scales food output per turn at every system",
  },
  {
    key: "shipProdMult",
    label: "Ship Production",
    min: 0.1,
    max: 4,
    step: 0.05,
    description: "Scales ships built per turn at every system",
  },
  {
    key: "popGrowthMult",
    label: "Population Growth",
    min: 0,
    max: 5,
    step: 0.1,
    description: "Scales headcount growth when food is plentiful (0 = frozen)",
  },
  {
    key: "starvationMult",
    label: "Starvation Rate",
    min: 0,
    max: 5,
    step: 0.1,
    description: "How fast population dies during food shortages (0 = immortal starving worlds)",
  },
  {
    key: "taxMult",
    label: "Tax Income",
    min: 0,
    max: 3,
    step: 0.05,
    description: "Scales all empire tax revenue from population",
  },
];

const MARKET_SLIDERS: SliderSpec[] = [
  {
    key: "foodPriceElasticityMult",
    label: "Food Price Sensitivity",
    min: 0.1,
    max: 4,
    step: 0.1,
    description: "How strongly local food prices swing with supply/demand (higher = wilder prices)",
  },
  {
    key: "starvationFoodPriceCapMult",
    label: "Starvation Food Price Cap",
    min: 5,
    max: 100,
    step: 1,
    baseline: 100,
    formatValue: (v) => `${Math.round(v)}×`,
    description:
      "Ceiling on food price multiplier when colonies are starving (can reach up to ~100× base price at max desperation)",
  },
  {
    key: "traderShipCostMult",
    label: "Trader Ship Cost",
    min: 0.05,
    max: 5,
    step: 0.05,
    description: "Per-turn charter cost for background traders (lower = more trades spawn)",
  },
];

const COMBAT_SLIDERS: SliderSpec[] = [
  {
    key: "combatAttackMult",
    label: "Attacker Firepower",
    min: 0.1,
    max: 4,
    step: 0.05,
    description: "Scales damage attackers deal each round",
  },
  {
    key: "combatDefendMult",
    label: "Defender Firepower",
    min: 0.1,
    max: 4,
    step: 0.05,
    description: "Scales damage defenders deal each round (homeworld bonus still applies)",
  },
  {
    key: "collateralDamageMult",
    label: "Collateral Damage",
    min: 0,
    max: 5,
    step: 0.1,
    description: "Scales battle collateral damage to stockpiles and population (0 = bloodless wars)",
  },
];

function formatMult(v: number): string {
  return `${v.toFixed(2)}×`;
}

function MultSlider({
  spec,
  value,
  onChange,
}: {
  spec: SliderSpec;
  value: number;
  onChange: (v: number) => void;
}) {
  const baseline = spec.baseline ?? 1;
  const tol = baseline >= 10 ? 0.51 : 0.005;
  const isDefault = Math.abs(value - baseline) < tol;
  const display = spec.formatValue ? spec.formatValue(value) : formatMult(value);
  const isHigh = spec.formatValue ? value > baseline : value > 1.3;
  const isLow = spec.formatValue ? value < baseline * 0.5 : value < 0.7;

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2">
        <label className="text-xs font-medium text-st-fg">{spec.label}</label>
        <div className="flex items-center gap-2">
          <span
            className={`min-w-[3.5rem] text-right text-xs font-mono font-semibold tabular-nums ${
              isDefault
                ? "text-st-muted"
                : isHigh
                  ? "text-amber-400"
                  : isLow
                    ? "text-sky-400"
                    : "text-st-fg"
            }`}
          >
            {display}
          </span>
          {!isDefault && (
            <button
              type="button"
              onClick={() => onChange(baseline)}
              className="text-[10px] text-st-muted hover:text-st-fg underline"
              title={`Reset to ${spec.formatValue ? spec.formatValue(baseline) : formatMult(baseline)}`}
            >
              reset
            </button>
          )}
        </div>
      </div>
      <input
        type="range"
        min={spec.min}
        max={spec.max}
        step={spec.step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full h-1.5 appearance-none rounded-full bg-st-border cursor-pointer accent-st-accent"
      />
      <p className="text-[10px] text-st-muted">{spec.description}</p>
    </div>
  );
}

function SliderGroup({
  title,
  sliders,
  settings,
  onChange,
}: {
  title: string;
  sliders: SliderSpec[];
  settings: Settings;
  onChange: (key: keyof Settings, v: number) => void;
}) {
  return (
    <div className="space-y-3">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-st-muted border-b border-st-border pb-1">
        {title}
      </p>
      {sliders.map((spec) => (
        <MultSlider
          key={spec.key}
          spec={spec}
          value={settings[spec.key]}
          onChange={(v) => onChange(spec.key, v)}
        />
      ))}
    </div>
  );
}

export function GodModePanel({ gameId }: { gameId: Id<"sim_games"> }) {
  const serverSettings = useQuery(api.admin.mutations.getGameSettings, { gameId });
  const updateSettings = useMutation(api.admin.mutations.updateGameSettings);
  const resetSettings = useMutation(api.admin.mutations.resetGameSettings);

  const [local, setLocal] = useState<Settings>(DEFAULTS);
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  // Sync from server when loaded
  useEffect(() => {
    if (serverSettings !== undefined) {
      startTransition(() => {
        setLocal(serverSettings);
      });
    }
  }, [serverSettings]);

  function handleChange(key: keyof Settings, value: number) {
    setLocal((prev) => ({ ...prev, [key]: value }));
    setSavedAt(null);
  }

  async function handleApply() {
    setSaving(true);
    try {
      await updateSettings({ gameId, settings: local });
      setSavedAt(Date.now());
    } finally {
      setSaving(false);
    }
  }

  async function handleReset() {
    setResetting(true);
    try {
      await resetSettings({ gameId });
      setLocal(DEFAULTS);
      setSavedAt(null);
    } finally {
      setResetting(false);
    }
  }

  const hasChanges =
    serverSettings !== undefined &&
    (Object.keys(DEFAULTS) as Array<keyof Settings>).some((k) => {
      if (k === "traderLimitsAutomated") {
        return (
          local.traderLimitsAutomated !==
          (serverSettings.traderLimitsAutomated ?? DEFAULTS.traderLimitsAutomated)
        );
      }
      return Math.abs(local[k] - (serverSettings[k] ?? DEFAULTS[k])) > 0.001;
    });

  const anyNonDefault = (Object.keys(DEFAULTS) as Array<keyof Settings>).some((k) => {
    if (k === "traderLimitsAutomated") {
      return local.traderLimitsAutomated !== DEFAULTS.traderLimitsAutomated;
    }
    const def = DEFAULTS[k] as number;
    return Math.abs((local[k] as number) - def) > (def >= 10 ? 0.51 : 0.005);
  });

  if (serverSettings === undefined) {
    return (
      <p className="text-xs text-st-muted py-2">Loading settings…</p>
    );
  }

  return (
    <div className="space-y-5">
      <SliderGroup
        title="Economy"
        sliders={ECONOMY_SLIDERS}
        settings={local}
        onChange={handleChange}
      />
      <SliderGroup
        title="Markets & Traders"
        sliders={MARKET_SLIDERS}
        settings={local}
        onChange={handleChange}
      />
      <SliderGroup
        title="Combat"
        sliders={COMBAT_SLIDERS}
        settings={local}
        onChange={handleChange}
      />

      <div className="flex items-center gap-2 pt-1 border-t border-st-border">
        <Button
          type="button"
          disabled={saving || !hasChanges}
          onClick={() => void handleApply()}
          className="flex-1 text-xs py-1.5"
        >
          {saving ? "Applying…" : "Apply to Game"}
        </Button>
        <Button
          type="button"
          variant="secondary"
          disabled={resetting || !anyNonDefault}
          onClick={() => void handleReset()}
          className="text-xs py-1.5 px-3"
          title="Reset all multipliers to 1×"
        >
          {resetting ? "…" : "Reset All"}
        </Button>
      </div>

      {savedAt !== null && (
        <p className="text-[10px] text-emerald-400 text-center">
          Settings applied — takes effect next turn
        </p>
      )}
    </div>
  );
}
