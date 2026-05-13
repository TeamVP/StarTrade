export type NpcEmpirePlayer = {
  key: string;
  playerName: string;
  empireName: string;
  colorHex: string;
};

export const NPC_EMPIRE_PLAYERS: NpcEmpirePlayer[] = [
  {
    key: "maia-solenne",
    playerName: "Maia Solenne",
    empireName: "Solenne Protectorate",
    colorHex: "#a78bfa",
  },
  {
    key: "tomas-varek",
    playerName: "Tomas Varek",
    empireName: "Varek Foundry League",
    colorHex: "#f042d0",
  },
  {
    key: "nari-quell",
    playerName: "Nari Quell",
    empireName: "Quell Freeholds",
    colorHex: "#84cc16",
  },
  {
    key: "orin-kade",
    playerName: "Orin Kade",
    empireName: "Kade Meridian",
    colorHex: "#38bdf8",
  },
  {
    key: "selene-crow",
    playerName: "Selene Crow",
    empireName: "Crow Synod",
    colorHex: "#f472b6",
  },
  {
    key: "bastian-roe",
    playerName: "Bastian Roe",
    empireName: "Roe Compact",
    colorHex: "#f59e0b",
  },
  {
    key: "lyra-stone",
    playerName: "Lyra Stone",
    empireName: "Stone Cartel",
    colorHex: "#14b8a6",
  },
  {
    key: "ivon-marsk",
    playerName: "Ivon Marsk",
    empireName: "Marsk Directorate",
    colorHex: "#6366f1",
  },
  {
    key: "calla-ren",
    playerName: "Calla Ren",
    empireName: "Ren Accord",
    colorHex: "#22c55e",
  },
  {
    key: "dax-helion",
    playerName: "Dax Helion",
    empireName: "Helion Corsairs",
    colorHex: "#fb7185",
  },
];

const NPC_EMPIRE_PLAYER_BY_KEY = new Map(
  NPC_EMPIRE_PLAYERS.map((player) => [player.key, player]),
);

export function normalizeNpcEmpireKeys(keys: readonly string[]): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const rawKey of keys) {
    const key = rawKey.trim();
    if (key === "" || seen.has(key)) continue;
    if (!NPC_EMPIRE_PLAYER_BY_KEY.has(key)) {
      throw new Error(`Unknown NPC empire player: ${key}`);
    }
    seen.add(key);
    normalized.push(key);
  }

  return normalized;
}

export function getNpcEmpirePlayersForKeys(keys: readonly string[]): NpcEmpirePlayer[] {
  return normalizeNpcEmpireKeys(keys).map((key) => {
    const player = NPC_EMPIRE_PLAYER_BY_KEY.get(key);
    if (player === undefined) {
      throw new Error(`Unknown NPC empire player: ${key}`);
    }
    return player;
  });
}
