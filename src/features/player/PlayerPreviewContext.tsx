/* eslint-disable react-refresh/only-export-components -- provider + hooks */
import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { Id } from "../../../convex/_generated/dataModel";
import type { PlayerPreviewRouteConfig } from "./playerPreviewConfig";
import { useGalaxyData } from "@/features/galaxy/hooks/useGalaxyData";

export const PlayerPreviewContext = createContext<PlayerPreviewRouteConfig | null>(null);

export function PlayerPreviewProvider({
  value,
  children,
}: {
  value: PlayerPreviewRouteConfig;
  children: ReactNode;
}) {
  return (
    <PlayerPreviewContext.Provider value={value}>{children}</PlayerPreviewContext.Provider>
  );
}

export function usePlayerPreview(): PlayerPreviewRouteConfig {
  const ctx = useContext(PlayerPreviewContext);
  if (ctx === null) {
    throw new Error("usePlayerPreview must be used within PlayerPreviewProvider");
  }
  return ctx;
}

/** Resolves the preview empire in the active game by seeded display name. */
export function usePlayerEmpireId(): Id<"emp_states"> | null {
  const { empireName } = usePlayerPreview();
  const { empires } = useGalaxyData();
  return useMemo(() => {
    const hit = empires.find((e) => e.name === empireName);
    return hit?._id ?? null;
  }, [empires, empireName]);
}
