export function averageSpeed(distanceKm: number, hours: number): number {
    if (hours <= 0) {
        return 0; // Guard against invalid input
    }
    return Math.round((distanceKm / hours) * 100) / 100;
}

export function isPositiveNumber(x: unknown): boolean {
    return typeof x === "number" && x > 0;
}

import assert from 'node:assert';

// Self-test
if (import.meta.url === import.meta.url) {

    // Test averageSpeed with valid input
    assert.strictEqual(averageSpeed(240, 5), 48);
    assert.strictEqual(averageSpeed(120, 2), 60);
    assert.strictEqual(averageSpeed(300, 6), 50);
    assert.strictEqual(averageSpeed(100.5, 3), 33.5); // 100.5 / 3 = 33.5
    assert.strictEqual(averageSpeed(75, 1.5), 50);     // 75 / 1.5 = 50

    // Test rounding to 2 decimals
    assert.strictEqual(averageSpeed(100, 3), 33.33);

    // Test with hours <= 0
    assert.strictEqual(averageSpeed(240, 0), 0);
    assert.strictEqual(averageSpeed(240, -5), 0);

    // Test isPositiveNumber
    assert.strictEqual(isPositiveNumber(5), true);
    assert.strictEqual(isPositiveNumber(0), false);
    assert.strictEqual(isPositiveNumber(-3), false);
    assert.strictEqual(isPositiveNumber(null), false);
    assert.strictEqual(isPositiveNumber(undefined), false);
    assert.strictEqual(isPositiveNumber("5"), false);

    console.log("All averageSpeed tests passed!");
}
