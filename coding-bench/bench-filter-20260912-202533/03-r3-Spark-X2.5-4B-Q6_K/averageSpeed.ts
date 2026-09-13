import assert from 'node:assert';
import { pathToFileURL } from 'node:url';

export function averageSpeed(distanceKm: number, hours: number): number {
    if (hours <= 0) {
        throw new Error("hours must be greater than 0");
    }
    return Math.round((distanceKm / hours) * 100) / 100;
}

export function isPositiveNumber(x: unknown): boolean {
    return typeof x === "number" && Number.isFinite(x) && x > 0;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
    // Self-test
    assert.strictEqual(averageSpeed(240, 5), 48);
    assert.strictEqual(averageSpeed(100, 2), 50);
    assert.strictEqual(averageSpeed(10, 3), 3.33);
    assert.strictEqual(isPositiveNumber(1), true);
    assert.strictEqual(isPositiveNumber(0), false);
    assert.strictEqual(isPositiveNumber(-5), false);
    assert.strictEqual(isPositiveNumber("5"), false);
    console.log("all tests passed");
}
