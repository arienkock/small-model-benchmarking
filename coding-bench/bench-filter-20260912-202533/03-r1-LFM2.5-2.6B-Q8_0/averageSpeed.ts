export function averageSpeed(distanceKm: number, hours: number): number {
    return Math.round((distanceKm / hours) * 100) / 100;
}

export function isPositiveNumber(x: unknown): boolean {
    return typeof x === 'number' && x > 0;
}

// Self-test when run directly
if (require.main === module) {
    // Test averageSpeed
    const result1 = averageSpeed(240, 5);
    expect(result1).toBe(48);
    const result2 = averageSpeed(100, 2);
    expect(result2).toBe(50);
    const result3 = averageSpeed(150, 3);
    expect(result3).toBe(50);
    // Test isPositiveNumber
    expect(isPositiveNumber(5)).toBe(true);
    expect(isPositiveNumber(-1)).toBe(false);
    expect(isPositiveNumber(0)).toBe(false);
    expect(isPositiveNumber("5")).toBe(false);
    expect(isPositiveNumber("abc")).toBe(false);
    console.log('All tests passed!');
}

