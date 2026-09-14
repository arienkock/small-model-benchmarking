export function averageSpeed(distanceKm: number, hours: number): number {
    if (hours === 0) {
        throw new Error("hours must be greater than 0");
    }
    return Math.round((distanceKm / hours) * 100) / 100;
}

export function isPositiveNumber(x: unknown): boolean {
    return typeof x === "number" && x > 0;
}

// Small self-test.
import { pathToFileURL } from "node:url";
import assert from "node:assert";

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
    assert.strictEqual(averageSpeed(240, 5), 48);
    assert.strictEqual(averageSpeed(100, 4), 25);
    assert.strictEqual(averageSpeed(240, 5), 48.0);
    assert.strictEqual(averageSpeed(100, 3), 33.33);

    assert.strictEqual(isPositiveNumber(5), true);
    assert.strictEqual(isPositiveNumber(0), false);
    assert.strictEqual(isPositiveNumber(-1), false);
    assert.strictEqual(isPositiveNumber("5"), false);
    assert.strictEqual(isPositiveNumber(undefined), false);

    console.log("all tests passed");
}
