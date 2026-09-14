// averageSpeed.ts
export function averageSpeed(distanceKm: number, hours: number): number {
    const result = distanceKm / hours;
    // round to 2 decimals
    return Math.round(result * 100) / 100;
}

export function isPositiveNumber(x: unknown): boolean {
    if (typeof x !== 'number') return false;
    return x > 0;
}

// Small self-test
if (require.main === module) {
    // Test averageSpeed
    console.log('Testing averageSpeed...');
    console.log('averageSpeed(240, 5) =', averageSpeed(240, 5)); // expected 48
    console.log('averageSpeed(100, 2) =', averageSpeed(100, 2)); // expected 50
    console.log('averageSpeed(300, 10) =', averageSpeed(300, 10)); // expected 30
    // Test isPositiveNumber
    console.log('isPositiveNumber(5) =', isPositiveNumber(5)); // true
    console.log('isPositiveNumber(-1) =', isPositiveNumber(-1)); // false
    console.log('isPositiveNumber(0) =', isPositiveNumber(0)); // false
    console.log('isPositiveNumber(null) =', isPositiveNumber(null)); // false
    console.log('isPositiveNumber(3.14) =', isPositiveNumber(3.14)); // true
    // End
    process.exit(0);
}