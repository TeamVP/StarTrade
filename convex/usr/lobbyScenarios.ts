export type LobbyScenarioKey = "starter-small-1" | "starter-small-2" | "starter-medium-1";

export type MapTier = "small" | "medium" | "large";

export type StarterLobbyScenario = {
  key: LobbyScenarioKey;
  name: string;
  mapKey: "v1-twenty" | "v1-medium";
  mapTier: MapTier;
  requiredSmallWins: number;
  requiredMediumWins: number;
  npcEmpireKeys: string[];
  automatedEmpireKeys: string[];
  sortOrder: number;
};

export const STARTER_LOBBY_SCENARIOS: StarterLobbyScenario[] = [
  {
    key: "starter-small-1",
    name: "Game 1",
    mapKey: "v1-twenty",
    mapTier: "small",
    requiredSmallWins: 0,
    requiredMediumWins: 0,
    npcEmpireKeys: [],
    automatedEmpireKeys: ["iron"],
    sortOrder: 1,
  },
  {
    key: "starter-small-2",
    name: "Game 2",
    mapKey: "v1-twenty",
    mapTier: "small",
    requiredSmallWins: 0,
    requiredMediumWins: 0,
    npcEmpireKeys: [],
    automatedEmpireKeys: ["iron"],
    sortOrder: 2,
  },
  {
    key: "starter-medium-1",
    name: "Game 3",
    mapKey: "v1-medium",
    mapTier: "medium",
    requiredSmallWins: 2,
    requiredMediumWins: 0,
    npcEmpireKeys: ["maia-solenne"],
    automatedEmpireKeys: ["iron", "npc-maia-solenne"],
    sortOrder: 3,
  },
];

const STARTER_LOBBY_SCENARIO_BY_KEY = new Map(
  STARTER_LOBBY_SCENARIOS.map((scenario) => [scenario.key, scenario]),
);

export function getStarterLobbyScenario(
  key: string,
): StarterLobbyScenario | null {
  return STARTER_LOBBY_SCENARIO_BY_KEY.get(key as LobbyScenarioKey) ?? null;
}

export function mapTierFromMapKey(mapKey: string): MapTier {
  if (mapKey === "v1-medium") {
    return "medium";
  }
  if (mapKey === "v1-spiral" || mapKey === "v1-large") {
    return "large";
  }
  return "small";
}