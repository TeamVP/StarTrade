/**
 * Partial-move splits name child fleets `"<parent> detachment"`. Repeated splits stack the word
 * ("… detachment detachment …"). Collapse trailing repeats to a single ` detachment` for labels.
 */
export function normalizeFleetDetachmentDisplayName(name: string): string {
  const trimmed = name.trimEnd();
  return trimmed.replace(/(?:\s+detachment)+$/i, " detachment");
}
