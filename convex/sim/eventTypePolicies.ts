export const TRADER_EVENT_DISPATCHED = "bg_trader_dispatched";
export const TRADER_EVENT_DELIVERED = "bg_trader_delivered";

export type SoundscapeActionType = "attack" | "defense" | "exploration";

export const TRADER_EVENT_TYPES = [
  TRADER_EVENT_DISPATCHED,
  TRADER_EVENT_DELIVERED,
] as const;

export type TraderEventType = (typeof TRADER_EVENT_TYPES)[number];

export const TRADER_EVENT_LABELS: Record<TraderEventType, string> = {
  [TRADER_EVENT_DISPATCHED]: "Trader Dispatched",
  [TRADER_EVENT_DELIVERED]: "Trader Delivered",
};

export const SOUNDSCAPE_ATTACK_EVENT_TYPES = [
  "battle_started",
  "battle_round_resolved",
  "battle_continues",
  "collateral_damage_applied",
  "system_claimed",
  "system_conquered",
] as const;

export const SOUNDSCAPE_DEFENSE_EVENT_TYPES = [
  "battle_reinforced",
  "battle_defender_changed",
  "system_held",
] as const;

export const SOUNDSCAPE_EXPLORATION_EVENT_TYPES = [
  "fleet_dispatched",
  "fleet_arrived",
  "colony_ship_dispatched",
  "colony_ship_arrived",
  "system_colonized",
] as const;

export const SOUNDSCAPE_EVENT_TYPES = [
  ...SOUNDSCAPE_ATTACK_EVENT_TYPES,
  ...SOUNDSCAPE_DEFENSE_EVENT_TYPES,
  ...SOUNDSCAPE_EXPLORATION_EVENT_TYPES,
] as const;

export type SoundscapeEventType = (typeof SOUNDSCAPE_EVENT_TYPES)[number];

const SOUNDSCAPE_ATTACK_EVENT_TYPE_SET = new Set<string>(SOUNDSCAPE_ATTACK_EVENT_TYPES);
const SOUNDSCAPE_DEFENSE_EVENT_TYPE_SET = new Set<string>(SOUNDSCAPE_DEFENSE_EVENT_TYPES);
const SOUNDSCAPE_EXPLORATION_EVENT_TYPE_SET = new Set<string>(SOUNDSCAPE_EXPLORATION_EVENT_TYPES);

export function isTraderEventType(eventType: string): eventType is TraderEventType {
  return TRADER_EVENT_TYPES.includes(eventType as TraderEventType);
}

export function classifySoundscapeEventActionType(
  eventType: string,
): SoundscapeActionType | null {
  if (SOUNDSCAPE_ATTACK_EVENT_TYPE_SET.has(eventType)) {
    return "attack";
  }
  if (SOUNDSCAPE_DEFENSE_EVENT_TYPE_SET.has(eventType)) {
    return "defense";
  }
  if (SOUNDSCAPE_EXPLORATION_EVENT_TYPE_SET.has(eventType)) {
    return "exploration";
  }
  return null;
}

export function isSoundscapeEventType(eventType: string): eventType is SoundscapeEventType {
  return classifySoundscapeEventActionType(eventType) !== null;
}
