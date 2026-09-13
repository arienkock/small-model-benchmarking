import assert from 'node:assert'

// Compute average speed: distance / hours, rounded to 2 decimals
export function averageSpeed(distanceKm: number, hours: number): number {
  return Math.round((distanceKm / hours) * 100) / 100
}

// Check if a value is a positive number (number > 0)
export function isPositiveNumber(x: unknown): boolean {
  return typeof x === 'number' && x > 0
}
