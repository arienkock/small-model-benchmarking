export function averageSpeed(distanceKm: number, hours: number): number {
  if (hours === 0) {
    throw new Error("hours must be greater than 0");
  }
  return Math.round((distanceKm / hours) * 100) / 100;
}

export function isPositiveNumber(x: unknown): boolean {
  return typeof x === "number" && Number.isFinite(x) && x > 0;
}

// Small self-test
import assert from "node:assert";

assert.strictEqual(averageSpeed(240, 5), 48);
assert.strictEqual(averageSpeed(100, 2), 50);
assert.strictEqual(averageSpeed(1, 3), 0.33);
assert.strictEqual(averageSpeed(240, 5), 48);

assert.strictEqual(isPositiveNumber(1), true);
assert.strictEqual(isPositiveNumber(0), false);
assert.strictEqual(isPositiveNumber(-1), false);
assert.strictEqual(isPositiveNumber("1"), false);
assert.strictEqual(isPositiveNumber(NaN), false);

console.log("all tests passed");
