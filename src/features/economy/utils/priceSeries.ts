export type PricePoint = {
  turnNumber: number;
  unitPrice: number;
};

export function toRechartsSeries(points: PricePoint[]) {
  return points.map((point) => ({
    turn: point.turnNumber,
    price: point.unitPrice,
  }));
}
