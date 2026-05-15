import type { Doc } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

export type NpcEmpirePlayer = {
  key: string;
  playerName: string;
  empireName: string;
  colorHex: string;
  strategyLibraryKey: string | null;
  isActive: boolean;
  sortOrder: number;
};

export const NPC_EMPIRE_PLAYERS: NpcEmpirePlayer[] = [
  {
    key: "maia-solenne",
    playerName: "Maia Solenne",
    empireName: "Solenne Protectorate",
    colorHex: "#a78bfa",
    strategyLibraryKey: null,
    isActive: true,
    sortOrder: 10,
  },
  {
    key: "tomas-varek",
    playerName: "Tomas Varek",
    empireName: "Varek Foundry League",
    colorHex: "#f042d0",
    strategyLibraryKey: null,
    isActive: true,
    sortOrder: 20,
  },
  {
    key: "nari-quell",
    playerName: "Nari Quell",
    empireName: "Quell Freeholds",
    colorHex: "#84cc16",
    strategyLibraryKey: null,
    isActive: true,
    sortOrder: 30,
  },
  {
    key: "orin-kade",
    playerName: "Orin Kade",
    empireName: "Kade Meridian",
    colorHex: "#38bdf8",
    strategyLibraryKey: null,
    isActive: true,
    sortOrder: 40,
  },
  {
    key: "selene-crow",
    playerName: "Selene Crow",
    empireName: "Crow Synod",
    colorHex: "#f472b6",
    strategyLibraryKey: null,
    isActive: true,
    sortOrder: 50,
  },
  {
    key: "bastian-roe",
    playerName: "Bastian Roe",
    empireName: "Roe Compact",
    colorHex: "#f59e0b",
    strategyLibraryKey: null,
    isActive: true,
    sortOrder: 60,
  },
  {
    key: "lyra-stone",
    playerName: "Lyra Stone",
    empireName: "Stone Cartel",
    colorHex: "#14b8a6",
    strategyLibraryKey: null,
    isActive: true,
    sortOrder: 70,
  },
  {
    key: "ivon-marsk",
    playerName: "Ivon Marsk",
    empireName: "Marsk Directorate",
    colorHex: "#6366f1",
    strategyLibraryKey: null,
    isActive: true,
    sortOrder: 80,
  },
  {
    key: "calla-ren",
    playerName: "Calla Ren",
    empireName: "Ren Accord",
    colorHex: "#22c55e",
    strategyLibraryKey: null,
    isActive: true,
    sortOrder: 90,
  },
  {
    key: "dax-helion",
    playerName: "Dax Helion",
    empireName: "Helion Corsairs",
    colorHex: "#fb7185",
    strategyLibraryKey: null,
    isActive: true,
    sortOrder: 100,
  },
];

type DbCtx = { db: QueryCtx["db"] | MutationCtx["db"] };

const NPC_EMPIRE_PLAYER_BY_KEY = new Map(
  NPC_EMPIRE_PLAYERS.map((player) => [player.key, player]),
);

function sortNpcPlayers(left: NpcEmpirePlayer, right: NpcEmpirePlayer): number {
  if (left.sortOrder !== right.sortOrder) {
    return left.sortOrder - right.sortOrder;
  }
  return left.playerName.localeCompare(right.playerName);
}

function toNpcEmpirePlayer(row: Doc<"emp_npc_players">): NpcEmpirePlayer {
  return {
    key: row.key,
    playerName: row.playerName,
    empireName: row.empireName,
    colorHex: row.colorHex,
    strategyLibraryKey: row.strategyLibraryKey,
    isActive: row.isActive,
    sortOrder: row.sortOrder,
  };
}

export async function listNpcEmpirePlayers(
  ctx: DbCtx,
  args?: { includeInactive?: boolean; fallbackToBuiltIns?: boolean },
): Promise<NpcEmpirePlayer[]> {
  const rows = await ctx.db.query("emp_npc_players").collect();
  const players =
    rows.length === 0 && args?.fallbackToBuiltIns === true
      ? NPC_EMPIRE_PLAYERS
      : rows.map((row) => toNpcEmpirePlayer(row));
  return players
    .filter((player) => args?.includeInactive === true || player.isActive)
    .sort(sortNpcPlayers);
}

export async function getNpcEmpirePlayerByKey(
  ctx: DbCtx,
  key: string,
): Promise<NpcEmpirePlayer | null> {
  const existing = await ctx.db
    .query("emp_npc_players")
    .withIndex("by_key", (q) => q.eq("key", key))
    .unique();
  if (existing !== null) {
    return toNpcEmpirePlayer(existing);
  }
  return NPC_EMPIRE_PLAYER_BY_KEY.get(key) ?? null;
}

export async function normalizeNpcEmpireKeys(ctx: DbCtx, keys: readonly string[]): Promise<string[]> {
  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const rawKey of keys) {
    const key = rawKey.trim();
    if (key === "" || seen.has(key)) continue;
    const player = await getNpcEmpirePlayerByKey(ctx, key);
    if (player === null) {
      throw new Error(`Unknown NPC empire player: ${key}`);
    }
    seen.add(key);
    normalized.push(key);
  }

  return normalized;
}

export async function getNpcEmpirePlayersForKeys(
  ctx: DbCtx,
  keys: readonly string[],
): Promise<NpcEmpirePlayer[]> {
  const normalizedKeys = await normalizeNpcEmpireKeys(ctx, keys);
  return await Promise.all(
    normalizedKeys.map(async (key) => {
      const player = await getNpcEmpirePlayerByKey(ctx, key);
      if (player === null) {
        throw new Error(`Unknown NPC empire player: ${key}`);
      }
      return player;
    }),
  );
}

export function getBuiltInNpcEmpirePlayer(key: string): NpcEmpirePlayer | null {
  const player = NPC_EMPIRE_PLAYER_BY_KEY.get(key);
  if (player === undefined) {
      throw new Error(`Unknown NPC empire player: ${key}`);
  }
  return player;
}
