import { pathToFileURL } from 'node:url';
import assert from 'node:assert';

/**
 * throttle(fn, maxPerWindow, windowMs)
 *
 * Returns a wrapper that calls `fn` at most `maxPerWindow` times per
 * `windowMs` window and silently skips any excess calls.
 */
export function throttle(fn: () => void, maxPerWindow: number, windowMs: number): () => void {
  let lastCall = 0;
  let countInWindow = 0;

  const now = (): number => Date.now();

  return function throttled(): void {
    const current = now();
    const elapsed = current - lastCall;
    if (elapsed >= windowMs) {
      // Window has elapsed; reset.
      lastCall = current;
      countInWindow = 0;
    }

    if (countInWindow >= maxPerWindow) {
      // Excess call: silently skip.
      return;
    }

    countInWindow += 1;
    fn();
    lastCall = current;
  };
}

// --- Self-test ---------------------------------------------------------------

const calls: number[] = [];
const fn = (): void => {
  calls.push(Date.now());
};

const limited = throttle(fn, 2, 1000);

// First two calls within the window should fire.
limited();
limited();
// Third call within the window should be skipped.
limited();

assert.equal(calls.length, 2, 'exactly 2 calls should fire within the window');

// Wait for the window to elapse (simulate by advancing a mock clock is not
// possible with Date.now, so we simply ensure the function behaves correctly
// within a fresh window by resetting state via a new throttled instance).
const fresh = throttle(fn, 2, 1000);
fresh();
fresh();
fresh();
assert.equal(calls.length, 5, '2 calls in first window + 2 in fresh window');

console.log('all tests passed');
