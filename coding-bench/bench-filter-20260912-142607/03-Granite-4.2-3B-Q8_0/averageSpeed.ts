export function averageSpeed(distanceKm: number, hours: number): number {
  // distance / hours, rounded to 2 decimals
  return Math.round((distanceKm / hours) * 100) / 100;
}

export function isPositiveNumber(x: unknown): boolean {
  if (typeof x === 'number' && x > 0) {
    return true;
  }
  return false;
}

// Small self-test when executed directly
console.log('Testing averageSpeed:');
console.log('averageSpeed(240, 5) =', averageSpeed(240, 5), '(expected 48.0)');
console.log('averageSpeed(100, 2) =', averageSpeed(100, 2), '(expected 50.0)');
console.log('isPositiveNumber(5) =', isPositiveNumber(5), '(expected true)');
console.log('isPositiveNumber(-1) =', isPositiveNumber(-1), '(expected false)');
console.log('isPositiveNumber(0) =', isPositiveNumber(0), '(expected false)');
console.log('isPositiveNumber(3.5) =', isPositiveNumber(3.5), '(expected true)');
console.log('isPositiveNumber("5") =', isPositiveNumber('5'), '(expected false)');
