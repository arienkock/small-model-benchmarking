export function averageSpeed(distanceKm: number, hours: number): number {
    if (hours === 0) {
        throw new Error('hours must be greater than 0');
    }
    return Math.round((distanceKm / hours) * 100) / 100;
}

export function isPositiveNumber(x: unknown): boolean {
    return typeof x === 'number' && x > 0;
}

// Self-test
import assert from 'node:assert';

function runSelfTest(): void {
    assert.strictEqual(averageSpeed(240, 5), 48);
    assert.strictEqual(averageSpeed(100, 1), 100);
    assert.strictEqual(averageSpeed(5, 2), 2.5);
    assert.strictEqual(averageSpeed(1, 3), 0.33);
    assert.strictEqual(isPositiveNumber(5), true);
    assert.strictEqual(isPositiveNumber(0), false);
    assert.strictEqual(isPositiveNumber(-1), false);
    assert.strictEqual(isPositiveNumber('5'), false);
    assert.throws(() => averageSpeed(100, 0), /hours must be greater than 0/);
    console.log('all tests passed');
}

runSelfTest();
