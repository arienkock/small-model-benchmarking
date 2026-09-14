export function averageSpeed(distanceKm: number, hours: number): number {
  if (hours <= 0) {
    throw new Error("hours must be greater than 0");
  }
  return Math.round((distanceKm / hours) * 100) / 100;
}

export function isPositiveNumber(x: unknown): boolean {
  return typeof x === "number" && Number.isFinite(x) && x > 0;
}

// Self-test
import assert from "node:assert";

const runSelfTest = () => {
  assert.strictEqual(averageSpeed(240, 5), 48);
  assert.strictEqual(averageSpeed(240, 6), 40);
  assert.strictEqual(averageSpeed(100, 3), 33.33);
  assert.strictEqual(averageSpeed(10, 4), 2.5);

  assert.strictEqual(isPositiveNumber(5), true);
  assert.strictEqual(isPositiveNumber(0), false);
  assert.strictEqual(isPositiveNumber(-1), false);
  assert.strictEqual(isPositiveNumber("5"), false);
  assert.strictEqual(isPositiveNumber(NaN), false);

  console.log("all self-tests passed");
};

runSelfTest();
