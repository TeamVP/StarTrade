export type GalaxyLinkRow = {
  fromSystemId: string;
  toSystemId: string;
};

export function systemsShareLink(
  links: GalaxyLinkRow[],
  systemA: string,
  systemB: string,
): boolean {
  return links.some(
    (link) =>
      (link.fromSystemId === systemA && link.toSystemId === systemB) ||
      (link.fromSystemId === systemB && link.toSystemId === systemA),
  );
}
