// Objective grader for filter task 2 (throttle).
// throttle(fn, maxPerWindow, windowMs) must call fn at most maxPerWindow times
// per window and silently skip the excess.
import assert from 'node:assert';
import { throttle } from './throttle.ts';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let n = 0;
const t = throttle(() => { n += 1; }, 3, 200);

for (let i = 0; i < 10; i++) t();
assert.strictEqual(n, 3, `expected exactly 3 calls in the first window, got ${n}`);

await sleep(280);
for (let i = 0; i < 10; i++) t();
assert.strictEqual(n, 6, `expected 3 more calls in the next window (6 total), got ${n}`);

console.log('GRADER_OK throttle');
