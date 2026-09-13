// averageSpeed.ts
// Export function averageSpeed(distanceKm: number, hours: number): number
// Export function isPositiveNumber(x: unknown): boolean

export function averageSpeed(distanceKm: number, hours: number): number {
    // distance / hours, rounded to 2 decimals
    const result = distanceKm / hours;
    return Math.round(result * 100) / 100;
}

export function isPositiveNumber(x: unknown): boolean {
    if (typeof x !== 'number') return false;
    return x > 0;
}
