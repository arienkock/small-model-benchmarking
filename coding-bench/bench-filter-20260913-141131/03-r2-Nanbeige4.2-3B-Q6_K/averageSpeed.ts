export function averageSpeed(distanceKm: number, hours: number): number {
    return Math.round((distanceKm / hours) * 100) / 100;
}

export function isPositiveNumber(x: unknown): boolean {
    return typeof x === 'number' && x > 0;
}

// Self-test
if (import.meta.url === import.meta.url.href) {
    const assert = require('node:assert');

    // Test averageSpeed
    assert.strictEqual(averageSpeed(240, 5), 48, 'Expected 48 for 240/5');
    assert.strictEqual(averageSpeed(120, 2), 60, 'Expected 60 for 120/2');
    assert.strictEqual(averageSpeed(300, 6.75), 44.44, 'Expected ~44.44 for 300/6.75');
    assert.strictEqual(averageSpeed(10, 3), 3.33, 'Expected 3.33 for 10/3');

    // Test isPositiveNumber
    assert.strictEqual(isPositiveNumber(5), true, '5 should be positive');
    assert.strictEqual(isPositiveNumber(-3), false, '-3 should not be positive');
    assert.strictEqual(isPositiveNumber(0), false, '0 should not be positive');
    assert.strictEqual(isPositiveNumber(NaN), false, 'NaN should not be positive');
    assert.strictEqual(isPositiveNumber(null), false, 'null should not be positive');
    assert.strictEqual(isPositiveNumber('5'), false, 'string "5" should not be positive');

    console.log('All self-tests passed.');
}
