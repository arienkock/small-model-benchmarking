export function averageSpeed(distanceKm: number, hours: number): number {
  return Number((distanceKm / hours).toFixed(2));
}

export function isPositiveNumber(x: unknown): boolean {
  if (typeof x !== 'number') return false;
  return Number.isFinite(x) && x > 0;
}

// Self-test
const tests: { fn: string; args: unknown[]; expected: unknown }[] = [
  { fn: 'averageSpeed', args: [240, 5], expected: 48 },
  { fn: 'averageSpeed', args: [100, 2], expected: 50 },
];

for (const test of tests) {
  // Resolve by function name from the exported functions
  const fn = (averageSpeed as any) as typeof averageSpeed;
  const result = fn(test.args[0], test.args[1]);
  console.log(`averageSpeed(${test.args[0]}, ${test.args[1]}) => ${result}, expected: ${test.expected}`);
}
