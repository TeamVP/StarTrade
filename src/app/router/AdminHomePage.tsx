import { useState } from "react";
import { Link } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import { useActiveGame } from "@/features/galaxy/hooks/useActiveGame";
import { gameModeSupportsTraderGameplay } from "@/features/games/gameMode";
import { cn } from "@/lib/utils";

type AdminLink = {
  to: string;
  label: string;
  description: string;
  requiresTraderGameplay?: boolean;
};

const liveLinks: readonly AdminLink[] = [
  { to: "/admin/map", label: "Map", description: "Galaxy view and live turn panels." },
  { to: "/admin/games", label: "Games", description: "Running games and admin controls." },
  { to: "/admin/fleet", label: "Fleet", description: "Fleet movements, dispatch, and routing." },
  { to: "/admin/combat", label: "Combat", description: "Battle state and combat diagnostics." },
  {
    to: "/admin/economy",
    label: "Economy",
    description: "Markets, production, and shortages.",
    requiresTraderGameplay: true,
  },
  { to: "/admin/empires", label: "Empires", description: "Empire status, holdings, and systems." },
  {
    to: "/admin/traders",
    label: "Traders",
    description: "Trader activity and logistics.",
    requiresTraderGameplay: true,
  },
  { to: "/admin/history", label: "History", description: "Timeline and recorded events." },
  { to: "/admin/results", label: "Results", description: "Durable finished-game outcomes and leaderboards." },
  { to: "/admin/balance", label: "Balance", description: "Tune live game parameters." },
] as const;

const adminLinks: readonly AdminLink[] = [
  { to: "/admin/db", label: "Database", description: "Database health, cleanup backlog, and maintenance actions." },
  { to: "/admin/settings", label: "Settings", description: "Authentication and site-wide controls." },
  { to: "/admin/users", label: "Users", description: "View auth users and create new user records." },
  {
    to: "/admin/moderation",
    label: "Moderation",
    description:
      "Review actionable community missions and strategies, including draft, ownerless, and recent moderation queues.",
  },
  {
    to: "/admin/strategies",
    label: "Strategies",
    description:
      "Manage the strategy library, edit strategy JSON, and control availability for NPCs and human users.",
  },
  {
    to: "/admin/mission",
    label: "Missions",
    description:
      "Manage mission records, progression sequencing, scenario JSON, and built-in player campaign content.",
  },
  {
    to: "/admin/maps",
    label: "Galaxy maps",
    description: "Create and edit sim_maps catalog records, then preview each map entry.",
  },
  {
    to: "/admin/empire-npcs",
    label: "Empire NPCs",
    description:
      "Manage NPC empire players, edit their metadata, and choose strategies from the library.",
  },
  {
    to: "/admin/trader-npcs",
    label: "Trader NPCs",
    description:
      "Manage NPC trader players, edit their metadata, and assign strategies from the library.",
    requiresTraderGameplay: true,
  },
] as const;

function AdminLinkCard(props: { to: string; label: string; description: string }) {
  return (
    <Link
      to={props.to}
      className="rounded-xl border border-st-border bg-st-panel px-4 py-4 transition-colors hover:border-st-accent hover:bg-st-bg"
    >
      <div className="text-sm font-semibold text-st-fg">{props.label}</div>
      <p className="mt-1 text-sm text-st-muted">{props.description}</p>
    </Link>
  );
}

export function AdminHomePage() {
  const { activeGame } = useActiveGame();
  const [liveOpen, setLiveOpen] = useState(false);
  const traderGameplayEnabled = gameModeSupportsTraderGameplay(activeGame?.mode);
  const visibleLiveLinks = liveLinks.filter(
    (link) => !link.requiresTraderGameplay || traderGameplayEnabled,
  );
  const visibleAdminLinks = adminLinks.filter(
    (link) => !link.requiresTraderGameplay || traderGameplayEnabled,
  );

  return (
    <div className="mx-auto max-w-[86.4rem] space-y-6 px-4 py-6">
      <Card className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-st-muted">Admin</p>
        <h1 className="text-2xl font-semibold text-st-fg">Control Center</h1>
        <p className="text-sm text-st-muted">
          Jump into the live operational views or administrative tooling from one place.
        </p>
        <p className="text-sm text-st-muted">
          Active game: <span className="font-medium text-st-fg">{activeGame?.name ?? "None selected"}</span>
        </p>
      </Card>

      <section className="space-y-3">
        <button
          type="button"
          onClick={() => setLiveOpen((open) => !open)}
          aria-expanded={liveOpen}
          className="flex w-full items-center justify-between rounded-xl border border-st-border bg-st-panel px-4 py-3 text-left transition-colors hover:border-st-accent hover:bg-st-bg"
        >
          <div>
            <h2 className="text-lg font-semibold text-st-fg">Live</h2>
            <p className="mt-1 text-sm text-st-muted">
              Live-game views for admins to inspect and operate the currently selected game.
            </p>
          </div>
          <ChevronRight className={cn("h-4 w-4 text-st-muted transition-transform", liveOpen ? "rotate-90" : undefined)} />
        </button>
        {liveOpen ? (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {visibleLiveLinks.map((link) => (
              <AdminLinkCard key={link.to} {...link} />
            ))}
          </div>
        ) : null}
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="text-lg font-semibold text-st-fg">Admin</h2>
          <p className="text-sm text-st-muted">
            Administrative tools that are not tied to one live game, including accounts and database maintenance.
          </p>
        </div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {visibleAdminLinks.map((link) => (
            <AdminLinkCard key={link.to} {...link} />
          ))}
        </div>
      </section>
    </div>
  );
}