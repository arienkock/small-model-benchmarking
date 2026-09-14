export function averageSpeed(distanceKm: number, hours: number): number {
    const speed = distanceKm / hours;
    // Round to 2 decimal places
    return Math.round(speed * 100) / 100;
}

export function isPositiveNumber(x: unknown): boolean {
    if (typeof x !== 'number' || Number.isNaN(x)) {
        return false;
    }
    return x > 0;
}

// Simple self-test when run directly
if (typeof module !== 'undefined' && module.exports) {
    const d = 240;
    const h = 5;
    const avg = averageSpeed(d, h);
    console.assert(avg === 48, `Expected 48, got ${avg}`);
    console.log('Self-test passed');
}