// averageSpeed.ts
// export function averageSpeed(distanceKm: number, hours: number): number
// (distance / hours, rounded to 2 decimals)
// export function isPositiveNumber(x: unknown): boolean

export function averageSpeed(distanceKm: number, hours: number): number {
    return Math.round((distanceKm / hours) * 100) / 100;
}

export function isPositiveNumber(x: unknown): boolean {
    if (typeof x !== 'number') return false;
    return x > 0;
}

// Simple self-test when run directly
if (import.meta.main || typeof module !== 'undefined' && module.exports) {
    console.log('Testing averageSpeed:');
    console.log('averageSpeed(240, 5) =', averageSpeed(240, 5)); // 48
    console.log('averageSpeed(100, 2) =', averageSpeed(100, 2)); // 50
    console.log('averageSpeed(150, 3) =', averageSpeed(150, 3)); // 50
    console.log('');
    console.log('Testing isPositiveNumber:');
    console.log('isPositiveNumber(5) =', isPositiveNumber(5)); // true
    console.log('isPositiveNumber(-1) =', isPositiveNumber(-1)); // false
    console.log('isPositiveNumber(0) =', isPositiveNumber(0)); // false
    console.log('isPositiveNumber("5") =', isPositiveNumber('5')); // false
}
