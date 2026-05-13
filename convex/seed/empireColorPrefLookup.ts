import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

/**
 * Loads catalog color overrides for a user. Keys are roster slot ids: `empireKey` for scripted
 * player empires (`aurora`, `iron`) or `npcPlayerKey` for NPC personas (e.g. `tomas-varek`).
 */
export async function loadEmpireColorPrefLookup(
  ctx: MutationCtx,
  userId: Id<"users"> | undefined | null,
): Promise<Record<string, string>> {
  if (userId === undefined || userId === null) {
    return {};
  }

  const rows = await ctx.db
    .query("usr_empire_color_prefs")
    .withIndex("by_userId", (q) => q.eq("userId", userId))
    .collect();

  const out: Record<string, string> = {};
  for (const row of rows) {
    const hex = row.colorHex.trim().toLowerCase();
    if (HEX_COLOR_RE.test(hex)) {
      out[row.preferenceKey] = hex;
    }
  }
  return out;
}

/** Returns the user’s preferred color for this catalog slot, or the seed default. */
export function pickEmpireCatalogColorHex(
  preferenceKey: string,
  fallbackHex: string,
  lookup: Record<string, string>,
): string {
  const hit = lookup[preferenceKey];
  if (hit !== undefined && HEX_COLOR_RE.test(hit)) {
    return hit.toLowerCase();
  }
  const fb = fallbackHex.trim();
  return HEX_COLOR_RE.test(fb) ? fb.toLowerCase() : fallbackHex;
}
