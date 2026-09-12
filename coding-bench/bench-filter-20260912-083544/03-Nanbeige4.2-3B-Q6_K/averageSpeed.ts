export function averageSpeed(distanceKm: number, hours: number): number {
  if (hours <= 0) {
    throw new Error('hours must be greater than 0');
  }
  return Math.round((distanceKm / hours) * 100) / 100;
}

export function isPositiveNumber(x: unknown): boolean {
  return typeof x === 'number' && isFinite(x) && x > 0;
}

// --- Self-test ---
import assert from 'node:assert';

// Test averageSpeed with valid input
assert.strictEqual(averageSpeed(240, 5), 48);
assert.strictEqual(averageSpeed(100, 3), 33.33);
assert.strictEqual(averageSpeed(1, 2), 0.5);

// Test rounding to 2 decimals
assert.strictEqual(averageSpeed(7, 3), 2.33);

// Test isPositiveNumber
assert.strictEqual(isPositiveNumber(5), true);
assert.strictEqual(isPositiveNumber(-3), false);
assert.strictEqual(isPositiveNumber(0), false);
assert.strictEqual(isPositiveNumber(NaN), false);
assert.strictEqual(isPositiveNumber(Infinity), false);
assert.strictEqual(isPositiveNumber(null), false);
assert.strictEqual(isPositiveNumber('5'), false);

// Test error case for averageSpeed with hours <= 0
try {
  averageSpeed(240, 0);
  assert.fail('Should have thrown for hours=0');
} catch (e) {
  assert.ok((e as Error).message.includes('hours must be greater than 0'));
}

try {
  averageSpeed(240, -5);
  assert.fail('Should have thrown for negative hours');
} catch (e) {
  assert.ok((e as Error).message.includes('hours must be greater than 0'));
}

console.log('All self-tests passed ✅');
