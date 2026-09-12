// Objective grader for filter task 3 (averageSpeed).
import assert from 'node:assert';
import { averageSpeed, isPositiveNumber } from './averageSpeed.ts';

assert.strictEqual(averageSpeed(240, 5), 48, 'averageSpeed(240,5) should be 48');
assert.strictEqual(averageSpeed(100, 3), 33.33, 'averageSpeed(100,3) should round to 33.33');
assert.strictEqual(isPositiveNumber(5), true, 'isPositiveNumber(5)');
assert.strictEqual(isPositiveNumber(0), false, 'isPositiveNumber(0)');
assert.strictEqual(isPositiveNumber(-1), false, 'isPositiveNumber(-1)');
assert.strictEqual(isPositiveNumber('5' as unknown), false, "isPositiveNumber('5')");

console.log('GRADER_OK averageSpeed');
