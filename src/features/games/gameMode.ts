export type GameMode = "conquest_core" | "conquest_plus" | "trader_economy";

export function resolveGameMode(mode: GameMode | undefined | null): GameMode {
  return mode ?? "trader_economy";
}

export function gameModeSupportsTraderGameplay(mode: GameMode | undefined | null): boolean {
  return resolveGameMode(mode) === "trader_economy";
}
