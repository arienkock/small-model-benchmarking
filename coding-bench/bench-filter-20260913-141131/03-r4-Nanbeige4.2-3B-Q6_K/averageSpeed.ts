export function averageSpeed(distanceKm: number, hours: number): number {
    if (hours <= 0) {
        throw new Error("hours must be greater than 0");
    }
    return Math.round((distanceKm / hours) * 100) / 100;
}

export function isPositiveNumber(x: unknown): boolean {
    return typeof x === 'number' && isFinite(x) && x > 0;
}

// Self-test (run unconditionally when file is executed directly)
import assert from 'node:assert';

console.log('Running self-tests...');

// Test averageSpeed with valid input
assert.equal(averageSpeed(240, 5), 48);
assert.equal(averageSpeed(120, 2), 60);
assert.equal(averageSpeed(7.5, 3), 2.5); // rounded to 2 decimals

// Test rounding
assert.equal(averageSpeed(100, 3), 33.33);

// Test error cases
try {
    averageSpeed(240, 0);
    assert.fail('Expected error for hours <= 0');
} catch (e) {
    assert.ok(e instanceof Error);
}

try {
    averageSpeed(240, -5);
    assert.fail('Expected error for negative hours');
} catch (e) {
    assert.ok(e instanceof Error);
}

// Test isPositiveNumber
assert.equal(isPositiveNumber(5), true);
assert.equal(isPositiveNumber(0), false);
assert.equal(isPositiveNumber(-3), false);
assert.equal(isPositiveNumber(Infinity), false);
assert.equal(isPositiveNumber(-Infinity), false);
assert.equal(isPositiveNumber(NaN), false);
assert.equal(isPositiveNumber('5'), false);
assert.equal(isPositiveNumber(null), false);
assert.equal(isPositiveNumber(undefined), false);

console.log('All self-tests passed!');
