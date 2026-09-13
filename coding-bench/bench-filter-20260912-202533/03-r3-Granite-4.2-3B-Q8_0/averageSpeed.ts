// export function averageSpeed(distanceKm: number, hours: number): number
// distance / hours, rounded to 2 decimals
export function averageSpeed(distanceKm: number, hours: number): number {
    return Math.round((distanceKm / hours) * 100) / 100;
}

// export function isPositiveNumber(x: unknown): boolean
export function isPositiveNumber(x: unknown): boolean {
    if (typeof x !== 'number') return false;
    return x > 0;
}

// Simple self-test (run with node averageSpeed.ts)
if (typeof module !== 'undefined' && require.main === module) {
    // Test averageSpeed
    console.log('Testing averageSpeed:');
    console.log('averageSpeed(240, 5) =', averageSpeed(240, 5)); // expected 48.0
    console.log('averageSpeed(100, 2) =', averageSpeed(100, 2)); // expected 50.0
    console.log('averageSpeed(1, 3) =', averageSpeed(1, 3)); // expected 0.33
    console.log('');
    console.log('Testing isPositiveNumber:');
    console.log('isPositiveNumber(5) =', isPositiveNumber(5)); // true
    console.log('isPositiveNumber(-3) =', isPositiveNumber(-3)); // false
    console.log('isPositiveNumber("5") =', isPositiveNumber("5")); // false
    console.log('isPositiveNumber(0) =', isPositiveNumber(0)); // false
    console.log('isPositiveNumber(2.5) =', isPositiveNumber(2.5)); // true
}
