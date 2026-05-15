export const AURORA_COMBINE_EMPIRE_NAME = "Aurora Combine";
export const IRON_DOMINION_EMPIRE_NAME = "Iron Dominion";

export type PlayerPreviewRouteConfig = {
  basePath: string;
  empireName: string;
};

export const PLAYER_PREVIEW_BY_PATH: Record<
  PlayerPreviewRouteConfig["basePath"],
  PlayerPreviewRouteConfig
> = {
  "/eplayer1": { basePath: "/eplayer1", empireName: AURORA_COMBINE_EMPIRE_NAME },
  "/eplayer2": { basePath: "/eplayer2", empireName: IRON_DOMINION_EMPIRE_NAME },
};
