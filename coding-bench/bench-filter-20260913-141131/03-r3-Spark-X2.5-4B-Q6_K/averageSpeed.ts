export function averageSpeed(distanceKm: number, hours: number): number {
    if (hours <= 0) {
        throw new Error("hours must be greater than 0");
    }
    return Math.round((distanceKm / hours) * 100) / 100;
}

export function isPositiveNumber(x: unknown): boolean {
    if (typeof x !== "number" || !Number.isFinite(x)) {
        return false;
    }
    return x > 0;
}

import { pathToFileURL } from "node:url";

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
    // Self-test
    const assert = (actual: unknown, expected: unknown, message: string) => {
        if (actual !== expected) {
            console.error(`Assertion failed: ${message} — expected ${expected}, got ${actual}`);
            process.exit(1);
        }
    };

    assert(averageSpeed(240, 5), 48, "averageSpeed(240, 5) should be 48");
    assert(averageSpeed(240, 5), 48, "averageSpeed(240, 5) second check");
    assert(averageSpeed(100, 2), 50, "averageSpeed(100, 2) should be 50");
    assert(averageSpeed(10, 2), 5, "averageSpeed(10, 2) should be 5");

    assert(isPositiveNumber(5), true, "isPositiveNumber(5) should be true");
    assert(isPositiveNumber(0), false, "isPositiveNumber(0) should be false");
    assert(isPositiveNumber(-3), false, "isPositiveNumber(-3) should be false");
    assert(isPositiveNumber("5"), false, "isPositiveNumber('5') should be false");
    assert(isPositiveNumber(NaN), false, "isPositiveNumber(NaN) should be false");
    assert(isPositiveNumber(Infinity), false, "isPositiveNumber(Infinity) should be false");

    console.log("all tests passed");
}
