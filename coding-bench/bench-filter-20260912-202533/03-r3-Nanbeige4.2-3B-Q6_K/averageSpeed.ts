export function averageSpeed(distanceKm: number, hours: number): number {
    return Math.round((distanceKm / hours) * 100) / 100;
}

export function isPositiveNumber(x: unknown): boolean {
    return typeof x === "number" && Number(x) > 0;
}

// Self-test
if (import.meta.url === import.meta.url) {
    // Basic averageSpeed tests
    assert.equal(averageSpeed(240, 5), 48, "240/5 should be 48");
    assert.equal(averageSpeed(120, 2.5), 48, "120/2.5 should be 48");
    assert.equal(averageSpeed(100, 3), 33.33, "100/3 rounded to 2 decimals should be 33.33");

    // isPositiveNumber tests
    assert.equal(isPositiveNumber(5), true, "5 should be positive");
    assert.equal(isPositiveNumber(0), false, "0 should not be positive");
    assert.equal(isPositiveNumber(-3), false, "-3 should not be positive");
    assert.equal(isPositiveNumber("5"), false, "string '5' should not be positive per type check");
    assert.equal(isPositiveNumber(NaN), false, "NaN should not be positive");

    console.log("All self-tests passed");
}
