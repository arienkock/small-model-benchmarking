export function averageSpeed(distanceKm: number, hours: number): number {
  return Math.round((distanceKm / hours) * 100) / 100;
}

export function isPositiveNumber(x: unknown): boolean {
  return typeof x === "number" && x > 0;
}
