export function averageSpeed(distanceKm: number, hours: number): number {
    return Math.round((distanceKm / hours) * 100) / 100;
}

export function isPositiveNumber(x: unknown): boolean {
    return typeof x === "number" && x > 0;
}

// --- Self-test ---
if (import.meta.url === import.meta.url) {
    import assert from "node:assert";

    // Test averageSpeed with valid input
    assert.strictEqual(averageSpeed(240, 5), 48);

    // Test averageSpeed rounding to 2 decimals
    assert.strictEqual(averageSpeed(100, 3), 33.33);

    // Test averageSpeed with negative hours (should still compute but logically invalid)
    assert.strictEqual(averageSpeed(240, -5), -48);

    // Test isPositiveNumber
    assert.strictEqual(isPositiveNumber(5), true);
    assert.strictEqual(isPositiveNumber(0), false);
    assert.strictEqual(isPositiveNumber(-3), false);
    assert.strictEqual(isPositiveNumber("5"), false);
    assert.strictEqual(isPositiveNumber(NaN), false);
    assert.strictEqual(isPositiveNumber(Infinity), false);

    console.log("All self-tests passed!");
}
