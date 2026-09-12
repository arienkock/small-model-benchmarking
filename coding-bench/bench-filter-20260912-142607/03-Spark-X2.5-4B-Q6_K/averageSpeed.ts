import assert from 'node:assert';
import { pathToFileURL } from 'node:url';

function roundToTwo(value: number): number {
  return Math.round(value * 100) / 100;
}

export function averageSpeed(distanceKm: number, hours: number): number {
  if (hours <= 0) {
    throw new Error('hours must be greater than 0');
  }
  return roundToTwo(distanceKm / hours);
}

export function isPositiveNumber(x: unknown): boolean {
  return typeof x === 'number' && x > 0;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  assert.equal(averageSpeed(240, 5), 48);
  assert.equal(averageSpeed(100, 2), 50);
  assert.equal(averageSpeed(75, 1.5), 50);
  assert.equal(averageSpeed(10, 3), 3.33);

  assert.equal(isPositiveNumber(3), true);
  assert.equal(isPositiveNumber(0), false);
  assert.equal(isPositiveNumber(-5), false);
  assert.equal(isPositiveNumber('10'), false);
  assert.equal(isPositiveNumber(null), false);

  console.log('all tests passed');
}
