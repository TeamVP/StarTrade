export type SeedSystem = {
  key: string;
  name: string;
  x: number;
  y: number;
};

export const V1_CORE_SYSTEMS: SeedSystem[] = [
  { key: "alpha", name: "Alpha Prime", x: 120, y: 160 },
  { key: "beta", name: "Beta Reach", x: 420, y: 260 },
  { key: "gamma", name: "Gamma Drift", x: 260, y: 420 },
];
