import type { MutationCtx } from "../_generated/server";

export const GAME_URL_CODE_LENGTH = 10;

function generateGameUrlCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(GAME_URL_CODE_LENGTH));
  return Array.from(bytes, (byte) => (byte % 36).toString(36)).join("");
}

export async function createUniqueGameUrlCode(ctx: MutationCtx): Promise<string> {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const urlCode = generateGameUrlCode();
    const existing = await ctx.db
      .query("sim_games")
      .withIndex("by_urlCode", (q) => q.eq("urlCode", urlCode))
      .unique();
    if (existing === null) {
      return urlCode;
    }
  }

  throw new Error("Unable to allocate a unique game URL code.");
}

export function gameUrlCodeNeedsRefresh(urlCode: string | undefined): boolean {
  return urlCode === undefined || urlCode.length !== GAME_URL_CODE_LENGTH;
}