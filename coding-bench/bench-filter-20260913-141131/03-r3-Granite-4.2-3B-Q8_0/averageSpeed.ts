export function averageSpeed(distanceKm: number, hours: number): number {
  return distanceKm / hours;
}

export function isPositiveNumber(x: unknown): boolean {
  if (typeof x !== 'number') return false;
  return x > 0;
}

// Self-test when run directly
if (import.meta.glob === undefined) {
  // For Node.js, use simple logic
  const testCases = [
    { distanceKm: 240, hours: 5, expected: 48 },
    { distanceKm: 100, hours: 2, expected: 50 },
    { distanceKm: 60, hours: 3, expected: 20 },
  ];

  for (const { distanceKm, hours, expected } of testCases) {
    const result = averageSpeed(distanceKm, hours);
    const rounded = Math.round(result * 100) / 100;
    if (rounded !== expected) {
      console.error(`FAIL: averageSpeed(${distanceKm}, ${hours}) = ${rounded}, expected ${expected}`);
    } else {
      console.log(`PASS: averageSpeed(${distanceKm}, ${hours}) = ${rounded}`);
    }
  }
  console.log('Self-test completed.');
}
