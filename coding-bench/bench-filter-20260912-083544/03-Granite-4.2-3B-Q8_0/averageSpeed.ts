// averageSpeed.ts
// Export function averageSpeed(distanceKm: number, hours: number): number
// Returns distance / hours rounded to 2 decimals.
// Export function isPositiveNumber(x: unknown): boolean
// Returns true if x is a positive number, false otherwise.

export function averageSpeed(distanceKm: number, hours: number): number {
    // Ensure inputs are valid numbers
    const speed = distanceKm / hours;
    // Round to 2 decimal places
    return Math.round(speed * 100) / 100;
}

export function isPositiveNumber(x: unknown): boolean {
    // Check if x is a number and > 0
    return typeof x === 'number' && x > 0;
}

// Simple self-test when run directly
if (require.main === module) {
    // Test averageSpeed
    const result = averageSpeed(240, 5);
    console.log(`averageSpeed(240, 5) = ${result} (expected ~48)`);
    // Verify rounded correctly
    const expected = roundToTwo(240 / 5);
    if (result === expected) {
        console.log('✅ averageSpeed test passed');
    } else {
        console.log(`❌ averageSpeed test failed: got ${result}, expected ${expected}`);
    }

    // Test isPositiveNumber
    console.log(`isPositiveNumber(5) = ${isPositiveNumber(5)} (expected true)`);
    console.log(`isPositiveNumber(-5) = ${isPositiveNumber(-5)} (expected false)`);
    console.log(`isPositiveNumber(0) = ${isPositiveNumber(0)} (expected false)`);
    console.log(`isPositiveNumber('5') = ${isPositiveNumber('5')} (expected false)`);
    console.log(`isPositiveNumber(4.5) = ${isPositiveNumber(4.5)} (expected true)`);

    // Helper for testing (since we cannot use Math.round directly, just compute)
    function roundToTwo(value: number): number {
        return Math.round(value * 100) / 100;
    }
}