/* eslint-disable react-refresh/only-export-components -- provider + hooks */
import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import type { PlayerPreviewRouteConfig } from "./playerPreviewConfig";
import { useActiveGame } from "@/features/galaxy/hooks/useActiveGame";
import { useGalaxyData } from "@/features/galaxy/hooks/useGalaxyData";

type JoinedGameRole = "observer" | "empire" | "trader" | "admin" | null;

export type PlayerGameMembership = {
  role: JoinedGameRole;
  runtimeVersion: "v1_empire" | "v2_game_actor";
  actorId: Id<"sim_game_actors"> | null;
  actorSlotNumber: number | null;
  actorLabel: string | null;
  actorDisplayName: string | null;
  empireId: Id<"emp_states"> | null;
  empireName: string | null;
  isEmpirePlayer: boolean;
  isSpectator: boolean;
  label: string;
};

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

function formatRoleLabel(role: JoinedGameRole): string {
  if (role === null) return "Spectator";
  if (role === "observer") return "Spectator";
  return role.charAt(0).toUpperCase() + role.slice(1);
}

export function usePlayerGameMembership(): PlayerGameMembership {
  const {
    empireName: configuredEmpireName,
    resolveMembershipFromActiveGame = false,
    spectatorLabel = "Spectator",
  } = usePlayerPreview();
  const { activeGame } = useActiveGame();
  const { empires } = useGalaxyData();

  const membershipQuery = useQuery(
    api.usr.queries.getMyGameMembership,
    resolveMembershipFromActiveGame && activeGame ? { gameId: activeGame._id } : "skip",
  );

  const previewEmpire = useMemo(() => {
    if (configuredEmpireName === null) {
      return null;
    }
    return empires.find((e) => e.name === configuredEmpireName) ?? null;
  }, [empires, configuredEmpireName]);

  return useMemo(() => {
    if (resolveMembershipFromActiveGame) {
      const role = membershipQuery?.role ?? null;
      const runtimeVersion = membershipQuery?.runtimeVersion ?? "v1_empire";
      const actorId = membershipQuery?.actorId ?? null;
      const actorSlotNumber = membershipQuery?.actorSlotNumber ?? null;
      const actorLabel = membershipQuery?.actorLabel ?? null;
      const actorDisplayName = membershipQuery?.actorDisplayName ?? null;
      const empireId = membershipQuery?.empireId ?? null;
      const empireName = membershipQuery?.empireName ?? null;
      const isEmpirePlayer = membershipQuery?.isEmpirePlayer ?? false;
      const isSpectator = membershipQuery?.isSpectator ?? true;
      return {
        role,
        runtimeVersion,
        actorId,
        actorSlotNumber,
        actorLabel,
        actorDisplayName,
        empireId,
        empireName,
        isEmpirePlayer,
        isSpectator,
        label:
          actorDisplayName ?? actorLabel ?? empireName ?? (isSpectator ? spectatorLabel : formatRoleLabel(role)),
      };
    }

    return {
      role: "empire",
      runtimeVersion: "v1_empire",
      actorId: null,
      actorSlotNumber: null,
      actorLabel: null,
      actorDisplayName: null,
      empireId: previewEmpire?._id ?? null,
      empireName: configuredEmpireName,
      isEmpirePlayer: previewEmpire !== null,
      isSpectator: false,
      label: configuredEmpireName ?? "Empire",
    };
  }, [
    configuredEmpireName,
    membershipQuery,
    previewEmpire,
    resolveMembershipFromActiveGame,
    spectatorLabel,
  ]);
}

export function usePlayerEmpireId(): Id<"emp_states"> | null {
  return usePlayerGameMembership().empireId;
}
