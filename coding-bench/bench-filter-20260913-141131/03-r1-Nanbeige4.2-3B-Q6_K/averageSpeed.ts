/**
 * averageSpeed.ts — Computes average speed and validates positive numbers.
 */

import assert from 'node:assert';

/**
 * Computes the average speed (distance / hours), rounded to 2 decimal places.
 *
 * @param distanceKm — Distance in kilometers.
 * @param hours — Number of hours. Must be > 0.
 * @returns Average speed rounded to 2 decimal places.
 */
export function averageSpeed(distanceKm: number, hours: number): number {
  return Math.round((distanceKm / hours) * 100) / 100;
}

/**
 * Checks whether a value is a positive number.
 *
 * @param x — Any value to check.
 * @returns true if x is a positive number; false otherwise.
 */
export function isPositiveNumber(x: unknown): boolean {
  return typeof x === 'number' && isFinite(x) && x > 0;
}


// --- Self-test ---
if (import.meta.url === 'file:///workspace/averageSpeed.ts') {
  // Test averageSpeed
  assert.strictEqual(averageSpeed(240, 5), 48, 'Expected 240/5 = 48');
  assert.strictEqual(averageSpeed(100, 3), 33.33, 'Expected ~33.33');
  assert.strictEqual(averageSpeed(50, 2.5), 20, 'Expected 20');

  // Test isPositiveNumber
  assert.strictEqual(isPositiveNumber(5), true);
  assert.strictEqual(isPositiveNumber(0), false);
  assert.strictEqual(isPositiveNumber(-3), false);
  assert.strictEqual(isPositiveNumber(NaN), false);
  assert.strictEqual(isPositiveNumber(Infinity), false);
  assert.strictEqual(isPositiveNumber(null), false);
  assert.strictEqual(isPositiveNumber('5'), false);

  console.log('All self-tests passed.');
}
