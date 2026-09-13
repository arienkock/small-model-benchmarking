export function averageSpeed(distanceKm: number, hours: number): number {
    return Math.round((distanceKm / hours) * 100) / 100;
}

export function isPositiveNumber(x: unknown): boolean {
    return typeof x === "number" && Number.isFinite(x) && x > 0;
}

// Self-test: run when executed directly via `node averageSpeed.ts`
import { pathToFileURL } from "node:url";
import assert from "node:assert";

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
    // averageSpeed tests
    assert.strictEqual(averageSpeed(240, 5), 48);
    assert.strictEqual(averageSpeed(100, 3), 33.33);
    assert.strictEqual(averageSpeed(50, 2.5), 20);

    // isPositiveNumber tests
    assert.strictEqual(isPositiveNumber(5), true);
    assert.strictEqual(isPositiveNumber(-3), false);
    assert.strictEqual(isPositiveNumber(0), false);
    assert.strictEqual(isPositiveNumber(NaN), false);
    assert.strictEqual(isPositiveNumber(Infinity), false);
    assert.strictEqual(isPositiveNumber("5"), false);
    assert.strictEqual(isPositiveNumber(null), false);
    assert.strictEqual(isPositiveNumber(undefined), false);

    console.log("All self-tests passed.");
}
