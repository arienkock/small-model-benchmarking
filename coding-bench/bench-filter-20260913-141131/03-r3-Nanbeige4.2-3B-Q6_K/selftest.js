// Self-test for averageSpeed.ts logic (runnable with plain node since TS ESM execution isn't supported here)

function averageSpeed(distanceKm, hours) {
    if (typeof hours !== "number" || hours <= 0) {
        throw new Error("hours must be a positive number");
    }
    return Math.round((distanceKm / hours) * 100) / 100;
}

function isPositiveNumber(x) {
    return typeof x === "number" && Number.isFinite(x) && x > 0;
}

import assert from "node:assert";

// Test averageSpeed with valid input
assert.strictEqual(averageSpeed(240, 5), 48, "Expected 48");
assert.strictEqual(averageSpeed(100, 4), 25, "Expected 25");
assert.strictEqual(averageSpeed(360, 9), 40, "Expected 40");
assert.strictEqual(averageSpeed(1.5, 0.25), 6, "Expected 6");

// Test rounding to 2 decimals
assert.strictEqual(averageSpeed(1000, 3), 333.33, "Expected 333.33");

// Test with hours = 0 (should throw)
try {
    averageSpeed(240, 0);
    assert.fail("Expected Error");
} catch (e) {
    assert.ok(e.message.includes("hours must be a positive number"));
}

// Test isPositiveNumber
assert.strictEqual(isPositiveNumber(5), true);
assert.strictEqual(isPositiveNumber(-3), false);
assert.strictEqual(isPositiveNumber(0), false);
assert.strictEqual(isPositiveNumber("5"), false);
assert.strictEqual(isPositiveNumber(NaN), false);
assert.strictEqual(isPositiveNumber(Infinity), false);

console.log("All self-tests passed!");
