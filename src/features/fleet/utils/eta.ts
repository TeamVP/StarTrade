export function turnsToArrival(distance: number, speedPerTurn: number) {
  if (speedPerTurn <= 0) return Number.POSITIVE_INFINITY;
  return Math.ceil(distance / speedPerTurn);
}
