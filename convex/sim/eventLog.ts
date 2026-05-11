import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

export async function insertSimEvent(
  ctx: MutationCtx,
  event: {
    gameId: Id<"sim_games">;
    turnNumber: number;
    eventType: string;
    actorType: string;
    actorId: string;
    targetType: string | null;
    targetId: string | null;
    summary: string;
    payload: Record<string, unknown>;
  },
): Promise<void> {
  await ctx.db.insert("sim_events", {
    ...event,
    payload: JSON.stringify(event.payload),
  });
}
