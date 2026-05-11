import { useState, useEffect } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

// Full settings type — mirrors what the server returns from getGameSettings.
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
  traderMinActive: number;
  traderMaxActive: number;
  traderShipHirePerTurn: number;
  traderDockingCost: number;
  foodStockpileMaxPerPop: number;
  foodStockpileMinPerPop: number;
  foodStressFactor: number;
  combatDefenderAdvantage: number;
  foodBasePrice: number;
  combatFoodDamageMult: number;
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
  traderMaxActive: 16,
  traderShipHirePerTurn: 500,
  traderDockingCost: 200,
  foodStockpileMaxPerPop: 3.0,
  foodStockpileMinPerPop: 0.5,
  foodStressFactor: 1.0,
  combatDefenderAdvantage: 2.0,
  foodBasePrice: 6,
  combatFoodDamageMult: 1.0,
};

type SliderSpec = {
  key: keyof Settings;
  label: string;
  min: number;
  max: number;
  step: number;
  description: string;
  baseline?: number;
  formatValue?: (v: number) => string;
};

const TRADER_SLIDERS: SliderSpec[] = [
  {
    key: "traderMinActive",
    label: "Min NPC Traders",
    min: 0,
    max: 16,
    step: 1,
    baseline: 0,
    formatValue: (v) => String(Math.round(v)),
    description:
      "Minimum number of background NPC traders active at once — system spawns extra routes to reach this floor",
  },
  {
    key: "traderMaxActive",
    label: "Max NPC Traders",
    min: 0,
    max: 32,
    step: 1,
    baseline: 16,
    formatValue: (v) => String(Math.round(v)),
    description:
      "Maximum background NPC traders allowed in transit simultaneously — hard cap on active voyages",
  },
  {
    key: "traderShipHirePerTurn",
    label: "Ship Hire Cost / Turn",
    min: 0,
    max: 2000,
    step: 50,
    baseline: 500,
    formatValue: (v) => `${Math.round(v)} cr`,
    description:
      "Credits charged per travel-turn for each NPC trader's hired ship — higher cost raises the price-spread needed to profit, reducing spawns",
  },
  {
    key: "traderDockingCost",
    label: "Docking Fee",
    min: 0,
    max: 2000,
    step: 50,
    baseline: 200,
    formatValue: (v) => `${Math.round(v)} cr`,
    description:
      "One-time fee paid when the trader's ship docks at the destination — adds to voyage cost threshold",
  },
];

const ECONOMY_SLIDERS: SliderSpec[] = [
  {
    key: "foodBasePrice",
    label: "Base Food Price",
    min: 1,
    max: 50,
    step: 1,
    baseline: 6,
    formatValue: (v) => `${Math.round(v)} cr`,
    description:
      "Equilibrium food price per unit when supply meets demand. All per-system prices scale from this — minimum floor ≈ 30% of this value, maximum crisis price scales up proportionally",
  },
  {
    key: "foodStockpileMaxPerPop",
    label: "Stockpile Max (× demand)",
    min: 1,
    max: 10,
    step: 0.5,
    baseline: 3.0,
    formatValue: (v) => `${v.toFixed(1)}×`,
    description:
      "When stockFood exceeds this multiple of one-turn demand the market is in oversupply — food prices decrease ~10% per turn until balance is restored",
  },
  {
    key: "foodStockpileMinPerPop",
    label: "Stockpile Min (× demand)",
    min: 0,
    max: 2,
    step: 0.1,
    baseline: 0.5,
    formatValue: (v) => `${v.toFixed(1)}×`,
    description:
      "When stockFood falls below this multiple of one-turn demand, food stress activates — prices rise sharply until the minimum is restored",
  },
  {
    key: "foodStressFactor",
    label: "Food Stress",
    min: 0.1,
    max: 5,
    step: 0.1,
    baseline: 1.0,
    formatValue: (v) => `${v.toFixed(1)}×`,
    description:
      "Multiplier on price growth rate during food stress (below minimum stockpile). 1.0 = standard ~25%/turn increase; 2.0 = ~50%/turn until minimum is achieved",
  },
];

const COMBAT_SLIDERS: SliderSpec[] = [
  {
    key: "combatFoodDamageMult",
    label: "Food Stockpile Damage",
    min: 0,
    max: 5,
    step: 0.1,
    baseline: 1.0,
    formatValue: (v) => `${v.toFixed(1)}×`,
    description:
      "Scales the likelihood that each round of collateral damage targets food stockpiles. 0 = food is immune; 1.0 = default (~35% of hits); 3.0 = food takes the vast majority of collateral each turn — expect severe food crises in protracted sieges",
  },
  {
    key: "combatDefenderAdvantage",
    label: "Defensive Advantage",
    min: 0.5,
    max: 9,
    step: 0.1,
    baseline: 2.0,
    formatValue: (v) => `${v.toFixed(1)}:1`,
    description:
      "Defender-to-attacker combat ratio — 2:1 means defenders inflict twice as many losses per ship than attackers; range 0.5:1 (easier to attack) to 9:1 (near-impenetrable defences)",
  },
];

// ─── Slider component ──────────────────────────────────────────────────────────

function BalanceSlider({
  spec,
  value,
  onChange,
}: {
  spec: SliderSpec;
  value: number;
  onChange: (v: number) => void;
}) {
  const baseline = spec.baseline ?? 1;
  const tol = baseline >= 10 ? 0.51 : 0.05;
  const isDefault = Math.abs(value - baseline) < tol;
  const display = spec.formatValue ? spec.formatValue(value) : value.toFixed(2);

  // Color cues: amber = above baseline, sky = below baseline
  const isHigh = value > baseline + tol;
  const isLow = value < baseline - tol;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <label className="text-sm font-medium text-st-fg">{spec.label}</label>
        <div className="flex items-center gap-2">
          <span
            className={`min-w-[4rem] text-right text-sm font-mono font-semibold tabular-nums ${
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
              className="text-[11px] text-st-muted hover:text-st-fg underline"
              title={`Reset to ${spec.formatValue ? spec.formatValue(baseline) : baseline}`}
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
      <p className="text-xs text-st-muted leading-relaxed">{spec.description}</p>
    </div>
  );
}

// ─── Section card ──────────────────────────────────────────────────────────────

function BalanceSection({
  title,
  icon,
  sliders,
  settings,
  onChange,
}: {
  title: string;
  icon: string;
  sliders: SliderSpec[];
  settings: Settings;
  onChange: (key: keyof Settings, v: number) => void;
}) {
  return (
    <Card className="space-y-5">
      <div className="flex items-center gap-2 pb-2 border-b border-st-border">
        <span className="text-lg">{icon}</span>
        <h3 className="text-sm font-semibold uppercase tracking-wider text-st-fg">
          {title}
        </h3>
      </div>
      {sliders.map((spec) => (
        <BalanceSlider
          key={spec.key}
          spec={spec}
          value={settings[spec.key]}
          onChange={(v) => onChange(spec.key, v)}
        />
      ))}
    </Card>
  );
}

// ─── Main component ────────────────────────────────────────────────────────────

export function BalancePanel({ gameId }: { gameId: Id<"sim_games"> }) {
  const serverSettings = useQuery(api.admin.mutations.getGameSettings, { gameId });
  const updateSettings = useMutation(api.admin.mutations.updateGameSettings);
  const resetSettings = useMutation(api.admin.mutations.resetGameSettings);

  const [local, setLocal] = useState<Settings>(DEFAULTS);
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  useEffect(() => {
    if (serverSettings !== undefined) {
      setLocal(serverSettings);
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

  const BALANCE_KEYS: Array<keyof Settings> = [
    "traderMinActive",
    "traderMaxActive",
    "traderShipHirePerTurn",
    "traderDockingCost",
    "foodBasePrice",
    "foodStockpileMaxPerPop",
    "foodStockpileMinPerPop",
    "foodStressFactor",
    "combatDefenderAdvantage",
    "combatFoodDamageMult",
  ];

  const hasChanges =
    serverSettings !== undefined &&
    BALANCE_KEYS.some((k) => {
      const def = DEFAULTS[k];
      const tol = def >= 10 ? 0.51 : 0.005;
      return Math.abs(local[k] - (serverSettings[k] ?? def)) > tol;
    });

  const anyNonDefault = BALANCE_KEYS.some((k) => {
    const def = DEFAULTS[k];
    const tol = def >= 10 ? 0.51 : 0.005;
    return Math.abs(local[k] - def) > tol;
  });

  if (serverSettings === undefined) {
    return (
      <div className="flex items-center justify-center py-12">
        <p className="text-sm text-st-muted">Loading settings…</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <BalanceSection
        title="Traders"
        icon="🚀"
        sliders={TRADER_SLIDERS}
        settings={local}
        onChange={handleChange}
      />
      <BalanceSection
        title="Economy"
        icon="🌾"
        sliders={ECONOMY_SLIDERS}
        settings={local}
        onChange={handleChange}
      />
      <BalanceSection
        title="Combat"
        icon="⚔️"
        sliders={COMBAT_SLIDERS}
        settings={local}
        onChange={handleChange}
      />

      {/* Action bar */}
      <div className="sticky bottom-0 bg-st-bg/95 backdrop-blur border-t border-st-border pt-4 pb-2 flex items-center gap-3">
        <Button
          type="button"
          disabled={saving || !hasChanges}
          onClick={() => void handleApply()}
          className="flex-1"
        >
          {saving ? "Applying…" : "Apply to Game"}
        </Button>
        <Button
          type="button"
          variant="secondary"
          disabled={resetting || !anyNonDefault}
          onClick={() => void handleReset()}
          className="px-4"
          title="Reset balance settings to defaults"
        >
          {resetting ? "…" : "Reset"}
        </Button>
      </div>

      {savedAt !== null && (
        <p className="text-xs text-emerald-400 text-center -mt-2 pb-2">
          Balance applied — takes effect next turn
        </p>
      )}
    </div>
  );
}
