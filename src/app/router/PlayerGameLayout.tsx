import { Navigate, Outlet } from "react-router-dom";
import { Authenticated, Unauthenticated } from "convex/react";
import { AppShell } from "@/app/layout/AppShell";
import { PlayerTopNav } from "@/app/layout/PlayerTopNav";
import { SignOutButton } from "@/features/usr/components/SignOutButton";
import { ActiveGameProvider } from "@/features/galaxy/context/ActiveGameContext";
import { PlayerPreviewProvider } from "@/features/player/PlayerPreviewContext";
import type { PlayerPreviewRouteConfig } from "@/features/player/playerPreviewConfig";

export function PlayerGameLayout({ config }: { config: PlayerPreviewRouteConfig }) {
  return (
    <>
      <Authenticated>
        <ActiveGameProvider>
          <PlayerPreviewProvider value={config}>
            <AppShell
              nav={<PlayerTopNav />}
              headerTrailing={<SignOutButton />}
              showProductTitle={false}
              rootClassName="flex h-dvh min-h-0 flex-col bg-st-bg text-st-fg"
              headerClassName="shrink-0 border-b border-st-border px-6 py-px"
              headerContentClassName="mx-auto flex w-full max-w-none flex-col gap-1 sm:flex-row sm:items-center sm:justify-between"
              mainClassName="flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden overflow-y-auto px-0 pb-0 pt-0 w-full max-w-none"
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
