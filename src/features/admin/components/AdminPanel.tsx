import { FormEvent, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export function AdminPanel() {
  const games = useQuery(api.sim.queries.listGames, { limit: 20 }) ?? [];
  const createGame = useMutation(api.sim.mutations.createGame);
  const reseedGame = useMutation(api.admin.mutations.reseedGame);
  const [creating, setCreating] = useState(false);
  const [seedingGameId, setSeedingGameId] = useState<Id<"sim_games"> | null>(null);

  async function onCreateGame(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const nameValue = formData.get("name");
    const mapKeyValue = formData.get("mapKey");
    const seedValue = formData.get("seed");
    const name = typeof nameValue === "string" ? nameValue.trim() : "";
    const mapKey = typeof mapKeyValue === "string" ? mapKeyValue.trim() : "";
    const seed = typeof seedValue === "string" ? seedValue.trim() : "";

    if (!name || !mapKey || !seed) return;

    setCreating(true);
    try {
      await createGame({
        name,
        mapKey,
        turnDurationMs: 15000,
        seed,
      });
      event.currentTarget.reset();
    } finally {
      setCreating(false);
    }
  }

  async function onSeed(gameId: Id<"sim_games">, mapKey: string) {
    setSeedingGameId(gameId);
    try {
      await reseedGame({
        gameId,
        mapKey,
      });
    } finally {
      setSeedingGameId(null);
    }
  }

  return (
    <Card>
      <h2 className="text-sm font-semibold uppercase tracking-wide text-st-muted">
        Admin Seeder
      </h2>
      <form className="mt-3 space-y-2" onSubmit={(event) => void onCreateGame(event)}>
        <input
          name="name"
          placeholder="Game name"
          className="w-full rounded border border-st-border bg-st-bg px-3 py-2 text-sm"
        />
        <input
          name="mapKey"
          defaultValue="v1-core"
          className="w-full rounded border border-st-border bg-st-bg px-3 py-2 text-sm"
        />
        <input
          name="seed"
          defaultValue="seed-001"
          className="w-full rounded border border-st-border bg-st-bg px-3 py-2 text-sm"
        />
        <Button
          type="submit"
          disabled={creating}
          className="w-full"
        >
          {creating ? "Creating..." : "Create Game"}
        </Button>
      </form>

      <div className="mt-4 space-y-2">
        {games.map((game) => (
          <div
            key={game._id}
            className="flex items-center justify-between rounded border border-st-border px-3 py-2 text-sm"
          >
            <div>
              <p>{game.name}</p>
              <p className="text-xs text-st-muted">{game.mapKey}</p>
            </div>
            <Button
              type="button"
              className="px-2 py-1 text-xs"
              disabled={seedingGameId === game._id}
              onClick={() => void onSeed(game._id, game.mapKey)}
            >
              {seedingGameId === game._id ? "Seeding..." : "Seed"}
            </Button>
          </div>
        ))}
      </div>
    </Card>
  );
}
