// average-speed.ts
// HTTP server that computes average speed from query parameters.

// Self-test
import assert from 'node:assert';

/**
 * Compute average speed in km/h.
 * @param distanceKm Distance in kilometers.
 * @param hours Hours spent.
 * @returns Rounded average speed.
 */
export function averageSpeed(distanceKm: number, hours: number): number {
  return Math.round((distanceKm / hours) * 100) / 100;
}

/**
 * Check whether a value is a positive number.
 * @param x Value to check.
 * @returns true if x is a positive number, otherwise false.
 */
export function isPositiveNumber(x: unknown): boolean {
  return typeof x === 'number' && x > 0;
}

// Self-test
assert.equal(averageSpeed(240, 5), 48);
assert.equal(isPositiveNumber(5), true);
assert.equal(isPositiveNumber(0), false);
assert.equal(isPositiveNumber(-3), false);
assert.equal(isPositiveNumber('5'), false);
