import { describe, expect, test } from "vitest";
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx } from "../../_generated/server";
import {
  DEFAULT_GAME_SETTINGS,
  gameSettingsMatchDefaults,
  normalizeGameSettingsForMode,
  persistGameSettings,
} from "./gameSettings";

function fakeGame(over: Partial<Doc<"sim_games">> = {}): Doc<"sim_games"> {
  return {
    _id: "settings_game_1" as Id<"sim_games">,
    _creationTime: 0,
    name: "Settings Test",
    status: "running",
    mapKey: "test-map",
    mode: "conquest_core",
    turnDurationMs: 60_000,
    currentTurn: 1,
    seed: "seed",
    createdByUserId: "user_1" as Id<"users">,
    ownerUserId: null,
    lobbyScenarioKey: null,
    startedAt: null,
    endedAt: null,
    winnerEmpireKey: null,
    runtimeVersion: "v1_empire",
    ...over,
  } as Doc<"sim_games">;
}

function buildCtx(params?: {
  sharedRow?: { _id: Id<"sim_game_settings"> } | null;
  traderRow?: { _id: Id<"sim_game_trader_settings"> } | null;
}) {
  const calls: Array<{ kind: string; table: string; value?: unknown }> = [];
  const ctx = {
    db: {
      query: (table: string) => {
        expect(["sim_game_settings", "sim_game_trader_settings"]).toContain(table);
        return {
          withIndex: (index: string, apply: (q: { eq: (field: string, value: unknown) => unknown }) => unknown) => {
            expect(index).toBe("by_gameId");
            apply({ eq: () => null });
            return {
              unique: async () =>
                table === "sim_game_settings"
                  ? (params?.sharedRow ?? null)
                  : (params?.traderRow ?? null),
            };
          },
        };
      },
      insert: async (table: string, value: unknown) => {
        calls.push({ kind: "insert", table, value });
        return "inserted_settings" as Id<"sim_game_settings">;
      },
      replace: async (table: string, _id: string, value: unknown) => {
        calls.push({ kind: "replace", table, value });
      },
      delete: async (table: string, _id: string) => {
        calls.push({ kind: "delete", table });
      },
    },
  } as unknown as MutationCtx;
  return { ctx, calls };
}

describe("game settings persistence", () => {
  test("normalizes conquest settings by clearing trader-only knobs", () => {
    const normalized = normalizeGameSettingsForMode(fakeGame({ mode: "conquest_core" }), {
      ...DEFAULT_GAME_SETTINGS,
      traderMaxActive: 9,
      traderHireChancePct: 77,
      combatAttackMult: 2,
    });

    expect(normalized.combatAttackMult).toBe(2);
    expect(normalized.traderMaxActive).toBe(DEFAULT_GAME_SETTINGS.traderMaxActive);
    expect(normalized.traderHireChancePct).toBe(DEFAULT_GAME_SETTINGS.traderHireChancePct);
  });

  test("treats the canonical defaults as non-persistent", () => {
    expect(gameSettingsMatchDefaults(DEFAULT_GAME_SETTINGS)).toBe(true);
    expect(
      gameSettingsMatchDefaults({
        ...DEFAULT_GAME_SETTINGS,
        combatAttackMult: 2,
      }),
    ).toBe(false);
  });

  test("deletes an existing settings row when a conquest game collapses to defaults", async () => {
    const { ctx, calls } = buildCtx({
      sharedRow: { _id: "settings_row_1" as Id<"sim_game_settings"> },
    });

    await persistGameSettings(
      ctx,
      fakeGame({ mode: "conquest_core" }),
      DEFAULT_GAME_SETTINGS,
    );

    expect(calls).toEqual([{ kind: "delete", table: "sim_game_settings" }]);
  });

  test("inserts only the meaningful non-default settings for conquest games", async () => {
    const { ctx, calls } = buildCtx();

    await persistGameSettings(
      ctx,
      fakeGame({ mode: "conquest_core" }),
      {
        ...DEFAULT_GAME_SETTINGS,
        combatAttackMult: 1.5,
        traderMaxActive: 12,
      },
    );

    expect(calls).toHaveLength(1);
    expect(calls[0]?.kind).toBe("insert");
    expect(calls[0]?.table).toBe("sim_game_settings");
    expect(calls[0]?.value).toMatchObject({
      gameId: "settings_game_1",
      combatAttackMult: 1.5,
    });
    expect(calls[0]?.value).not.toMatchObject({
      traderMaxActive: expect.anything(),
    });
  });

  test("persists trader-only overrides in the dedicated trader settings table", async () => {
    const { ctx, calls } = buildCtx();

    await persistGameSettings(
      ctx,
      fakeGame({ mode: "trader_economy" }),
      {
        ...DEFAULT_GAME_SETTINGS,
        traderMaxActive: 12,
      },
    );

    expect(calls).toHaveLength(1);
    expect(calls[0]?.kind).toBe("insert");
    expect(calls[0]?.table).toBe("sim_game_trader_settings");
    expect(calls[0]?.value).toMatchObject({
      gameId: "settings_game_1",
      traderMaxActive: 12,
    });
  });
});