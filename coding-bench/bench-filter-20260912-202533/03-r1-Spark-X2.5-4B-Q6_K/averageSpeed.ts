export function averageSpeed(distanceKm: number, hours: number): number {
    if (hours <= 0) {
        throw new Error("hours must be greater than 0");
    }
    return Math.round((distanceKm / hours) * 100) / 100;
}

export function isPositiveNumber(x: unknown): boolean {
    return typeof x === "number" && Number.isFinite(x) && x > 0;
}

import assert from "node:assert";

// Small self-test: run with `node averageSpeed.ts`
const testCases: Array<[number, number, number]> = [
    [240, 5, 48],
    [10, 2, 5],
    [100, 3, 33.33],
    [150, 4, 37.5],
];

for (const [distance, hours, expected] of testCases) {
    assert.strictEqual(averageSpeed(distance, hours), expected,
        `averageSpeed(${distance}, ${hours}) failed`);
}

assert.strictEqual(isPositiveNumber(1.5), true);
assert.strictEqual(isPositiveNumber(0), false);
assert.strictEqual(isPositiveNumber(-1), false);
assert.strictEqual(isPositiveNumber("5"), false);
assert.strictEqual(isPositiveNumber(NaN), false);

console.log("all tests passed");
