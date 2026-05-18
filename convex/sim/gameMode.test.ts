import { describe, expect, test } from "vitest";
import {
  compareTurnResolutionPhases,
  FIRST_TURN_RESOLUTION_PHASE,
  gameRunsResolutionPhase,
  nextTurnResolutionPhase,
  parseTurnResolutionPhase,
  resolutionPhasesBetween,
} from "./gameMode";

describe("game mode resolution phases", () => {
  test("uses a shared initial resolution phase constant", () => {
    expect(FIRST_TURN_RESOLUTION_PHASE).toBe("movement");
  });

  test("parses missing or invalid stored phases through the shared default", () => {
    expect(parseTurnResolutionPhase(undefined)).toBe(FIRST_TURN_RESOLUTION_PHASE);
    expect(parseTurnResolutionPhase("not_a_phase")).toBe(FIRST_TURN_RESOLUTION_PHASE);
    expect(parseTurnResolutionPhase("tradeSpawn")).toBe("tradeSpawn");
  });

  test("compares phase order through the shared registry", () => {
    expect(compareTurnResolutionPhases("economy", "economy")).toBe(0);
    expect(compareTurnResolutionPhases("npc", "trade")).toBeLessThan(0);
    expect(compareTurnResolutionPhases("garrisons", "tradeSpawn")).toBeGreaterThan(0);
  });

  test("conquest modes skip trader-only phases", () => {
    const conquestGame = { mode: "conquest_core" as const };

    expect(gameRunsResolutionPhase(conquestGame, "trade")).toBe(false);
    expect(gameRunsResolutionPhase(conquestGame, "traderSetup")).toBe(false);
    expect(gameRunsResolutionPhase(conquestGame, "tradeSpawn")).toBe(false);
    expect(nextTurnResolutionPhase(conquestGame, "npc")).toBe("garrisons");
    expect(resolutionPhasesBetween(conquestGame, "npc", "garrisons")).toEqual([]);
    expect(nextTurnResolutionPhase(conquestGame, "garrisons")).toBe("finalize");
  });

  test("trader economy mode retains trader-only phases", () => {
    const traderGame = { mode: "trader_economy" as const };

    expect(gameRunsResolutionPhase(traderGame, "trade")).toBe(true);
    expect(gameRunsResolutionPhase(traderGame, "traderSetup")).toBe(true);
    expect(gameRunsResolutionPhase(traderGame, "tradeSpawn")).toBe(true);
    expect(nextTurnResolutionPhase(traderGame, "npc")).toBe("trade");
    expect(resolutionPhasesBetween(traderGame, "npc", "garrisons")).toEqual([
      "trade",
      "traderSetup",
      "tradeSpawn",
    ]);
    expect(nextTurnResolutionPhase(traderGame, "tradeSpawn")).toBe("garrisons");
  });
});