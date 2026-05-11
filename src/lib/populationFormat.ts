/**
 * `gal_systems.population` and `emp_states.population` store absolute headcount (people).
 * Display compactly from below 1k up to 100B per star.
 */
export function formatPopulationPeople(people: number): string {
  if (!Number.isFinite(people) || people <= 0) return "0";
  const n = Math.floor(people);
  if (n < 1000) return n.toLocaleString("en-US");

  const tiers = [
    { div: 1_000_000_000 as const, suffix: "B" as const },
    { div: 1_000_000 as const, suffix: "M" as const },
    { div: 1000 as const, suffix: "k" as const },
  ];

  for (const { div, suffix } of tiers) {
    if (n >= div) {
      const v = n / div;
      const digits = v >= 100 ? 0 : v >= 10 ? 1 : 2;
      const compact = parseFloat(v.toFixed(digits));
      return `${compact.toLocaleString("en-US")}${suffix}`;
    }
  }

  return n.toLocaleString("en-US");
}

export function formatPopulationPeopleOptional(people: number | undefined): string {
  if (people === undefined) return "—";
  return formatPopulationPeople(people);
}
