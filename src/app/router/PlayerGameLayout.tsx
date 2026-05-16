import { Navigate, Outlet } from "react-router-dom";
import { Authenticated, Unauthenticated } from "convex/react";
import { AppShell } from "@/app/layout/AppShell";
import { PlayerTopNav } from "@/app/layout/PlayerTopNav";
import { ActiveGameProvider } from "@/features/galaxy/context/ActiveGameContext";
import { PlayerPreviewProvider } from "@/features/player/PlayerPreviewContext";
import { UserHeaderActions } from "@/features/usr/components/UserHeaderActions";
import type { PlayerPreviewRouteConfig } from "@/features/player/playerPreviewConfig";
import type { Id } from "../../../convex/_generated/dataModel";

export function PlayerGameLayout({
  config,
  initialSelectedGameId = null,
}: {
  config: PlayerPreviewRouteConfig;
  initialSelectedGameId?: Id<"sim_games"> | null;
}) {
  return (
    <>
      <Authenticated>
        <ActiveGameProvider
          key={config.basePath}
          storageKey={`starstrat:activeGameId:${config.basePath}`}
          initialSelectedGameId={initialSelectedGameId}
        >
          <PlayerPreviewProvider value={config}>
            <AppShell
              nav={<PlayerTopNav />}
              headerTrailing={<UserHeaderActions />}
              showProductTitle={false}
              rootClassName="flex h-dvh min-h-0 flex-col bg-st-bg text-st-fg"
              headerClassName="shrink-0 border-b border-st-border px-4 py-px sm:px-6"
              headerContentClassName="mx-auto flex w-full max-w-none flex-col gap-1 sm:flex-row sm:items-center sm:justify-between"
              mainClassName="flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden overflow-y-auto px-4 pt-4 pb-4 lg:px-0 lg:pt-0 lg:pb-0 w-full max-w-none"
            >
              <Outlet />
            </AppShell>
          </PlayerPreviewProvider>
        </ActiveGameProvider>
      </Authenticated>
      <Unauthenticated>
        <Navigate to="/sign-in" replace />
      </Unauthenticated>
    </>
  );
}
