export function averageSpeed(distanceKm: number, hours: number): number {
  return Math.round((distanceKm / hours) * 100) / 100;
}

export function isPositiveNumber(x: unknown): boolean {
  if (typeof x !== 'number') return false;
  return !isNaN(x) && x > 0;
}

// Self-test
function main() {
  const tests = [
    { avg: averageSpeed(240, 5), expected: 48 },
    { avg: averageSpeed(100, 5), expected: 20 },
    { avg: averageSpeed(0, 5), expected: 0 },
    { avg: averageSpeed(100, 1), expected: 100 },
  ];

  let passed = 0;
  for (const t of tests) {
    if (t.avg === t.expected) {
      console.log(`PASS: averageSpeed(${t.avg})`);
      passed++;
    } else {
      console.log(`FAIL: averageSpeed(100,5) => ${t.avg}, expected ${t.expected}`);
    }
  }

  const posTests = [
    { x: 5, expected: true },
    { x: -1, expected: false },
    { x: 0, expected: false },
    { x: NaN, expected: false },
    { x: "5", expected: false },
  ];

  for (const t of posTests) {
    const result = isPositiveNumber(t.x);
    if (result === t.expected) {
      console.log(`PASS: isPositiveNumber(${t.x}) => ${result}`);
      passed++;
    } else {
      console.log(`FAIL: isPositiveNumber(${t.x}) => ${result}, expected ${t.expected}`);
    }
  }

  console.log(`\n${passed}/${tests.length + posTests.length} tests passed`);
  if (passed === tests.length + posTests.length) {
    console.log('all tests passed');
  }
}

if (typeof main !== 'undefined') {
  main();
}
