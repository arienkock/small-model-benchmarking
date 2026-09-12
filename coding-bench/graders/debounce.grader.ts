// Objective grader for filter task 1 (debounce).
//
// Grades the model's EXPORTED function, not the model's own self-test. Round 1
// showed why: Nanbeige printed "all tests passed" twice before any assertion
// ran (its verdict was computed synchronously against an empty array), while
// Granite -- the only model that fixed all three seeded bugs -- crashed on an
// ESM idiom and scored lower. String-matching the transcript got the ranking
// backwards; running the code does not.
//
// Each assertion below targets one of the three seeded bugs:
//   bug 1  early `return` instead of clearTimeout -> keeps the FIRST args
//   bug 2  fn(args) instead of fn(...args)        -> args arrive double-wrapped
//   bug 3  timer nulled synchronously             -> nothing is ever cancelled
import assert from 'node:assert';
import { debounce } from './debounce.ts';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const calls: any[][] = [];
const fn = (...a: any[]) => { calls.push(a); };

const d = debounce(fn, 60);
d(1, 'a'); d(2, 'b'); d(3, 'c');

await sleep(25);
assert.strictEqual(calls.length, 0, `fired after 25ms but waitMs is 60 (got ${calls.length} calls)`);

await sleep(120);
assert.strictEqual(calls.length, 1, `expected exactly 1 call after the burst, got ${calls.length} (bug 3: timer nulled synchronously, so nothing cancels)`);
assert.deepStrictEqual(calls[0], [3, 'c'], `expected the LATEST args spread as [3,"c"], got ${JSON.stringify(calls[0])} (bug 1: early return keeps first args / bug 2: fn(args) double-wraps)`);

// Still debounces after the first fire.
d(9, 'z');
await sleep(120);
assert.strictEqual(calls.length, 2, `debounced fn stopped working after the first fire (got ${calls.length} calls)`);
assert.deepStrictEqual(calls[1], [9, 'z'], `second fire passed ${JSON.stringify(calls[1])}`);

console.log('GRADER_OK debounce');
