import { describe, expect, test } from "vitest";
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx } from "../../_generated/server";
import { applyBackgroundTrade } from "./applyBackgroundTrade";
import { maybeAdjustAutomatedNpcTraderLimits } from "./adjustAutomatedNpcTraderLimits";

function fakeGame(over: Partial<Doc<"sim_games">> = {}): Doc<"sim_games"> {
  return {
    _id: "game_invariant_1" as Id<"sim_games">,
    _creationTime: 0,
    status: "running",
    currentTurn: 10,
    createdByUserId: null,
    ownerUserId: null,
    missionKey: null,
    lobbyScenarioKey: null,
    runtimeVersion: "v1_empire",
    seed: "test-seed",
    mapKey: "test-map",
    maxPlayers: 2,
    currentPlayers: 2,
    turnDurationMs: 60_000,
    joinCode: "JOINCODE",
    isOfficial: false,
    mode: "conquest_core",
    retentionClass: "discarded",
    ...over,
  } as Doc<"sim_games">;
}

function fakeMutationCtx(game: Doc<"sim_games">): MutationCtx {
  return {
    db: {
      get: async (table: string, id: string) => {
        if (table === "sim_games" && id === game._id) {
          return game;
        }
        throw new Error(`Unexpected get(${table}, ${id})`);
      },
      query: () => {
        throw new Error("Trader invariant failed: unexpected db.query call.");
      },
      insert: async () => {
        throw new Error("Trader invariant failed: unexpected db.insert call.");
      },
      patch: async () => {
        throw new Error("Trader invariant failed: unexpected db.patch call.");
      },
      replace: async () => {
        throw new Error("Trader invariant failed: unexpected db.replace call.");
      },
      delete: async () => {
        throw new Error("Trader invariant failed: unexpected db.delete call.");
      },
      normalizeId: () => null,
      system: undefined,
    },
    auth: undefined,
    storage: undefined,
    scheduler: undefined,
    runQuery: undefined,
    runMutation: undefined,
    runAction: undefined,
  } as unknown as MutationCtx;
}

describe("trader mode helper invariants", () => {
  test("applyBackgroundTrade rejects conquest games before trader-side reads or writes", async () => {
    const ctx = fakeMutationCtx(fakeGame({ mode: "conquest_core" }));

    await expect(
      applyBackgroundTrade(ctx, {
        gameId: "game_invariant_1" as Id<"sim_games">,
        turnNumber: 10,
      }),
    ).rejects.toThrow("applyBackgroundTrade requires trader_economy mode; got conquest_core.");
  });

  test("NPC trader limit automation rejects conquest games before reading trader history", async () => {
    const ctx = fakeMutationCtx(fakeGame({ mode: "conquest_core" }));

    await expect(
      maybeAdjustAutomatedNpcTraderLimits(ctx, {
        gameId: "game_invariant_1" as Id<"sim_games">,
        completedTurn: 10,
      }),
    ).rejects.toThrow(
      "maybeAdjustAutomatedNpcTraderLimits requires trader_economy mode; got conquest_core.",
    );
  });
});