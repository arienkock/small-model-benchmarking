/**
 * Rate-limited throttle utility.
 *
 * Returns a wrapper that calls `fn` at most `maxPerWindow` times within every
 * `windowMs` window and silently skips excess calls.
 */

export interface ThrottleOptions {
  maxPerWindow: number;
  windowMs: number;
}

export function throttle<T extends (...args: never[]) => void>(
  fn: T,
  maxPerWindow: number,
  windowMs: number
): (...args: Parameters<T>) => void {
  const MAX_CALLS = maxPerWindow;
  const WINDOW_MS = windowMs;

  let lastCallTime = 0;
  let countInWindow = 0;

  const now = (): number => Date.now();

  return function throttled(...args: Parameters<T>): void {
    const current = now();
    const sinceLast = current - lastCallTime;

    if (sinceLast >= WINDOW_MS) {
      // Window expired: start a fresh window.
      countInWindow = 0;
    }

    if (countInWindow >= MAX_CALLS) {
      // Excess call: silently skip.
      return;
    }

    countInWindow += 1;
    lastCallTime = current;
    fn(...args);
  };
}

import assert from 'node:assert';

// Self-test: run with `node throttle.ts`
function runSelfTest(): void {
  let calls = 0;
  let lastArgs: unknown[] = [];

  const fn = (...args: unknown[]): void => {
    calls++;
    lastArgs = args;
  };

  const throttled = throttle(fn, 3, 1000);

  // 3 allowed calls within one window.
  throttled(1, 2, 3);
  throttled(1, 2, 3);
  throttled(1, 2, 3);

  // 4th and 5th calls within the window are silently skipped.
  throttled(1, 2, 3);
  throttled(1, 2, 3);

  assert.strictEqual(calls, 3, `expected 3 calls within window, got ${calls}`);

  // Wait for the window to expire, then allow 3 more calls.
  const start = Date.now();
  while (Date.now() - start < 1100) {
    // Busy-wait until the window has passed.
  }
  throttled(1, 2, 3);
  throttled(1, 2, 3);
  throttled(1, 2, 3);
  throttled(1, 2, 3); // still within the new window -> skipped

  assert.strictEqual(calls, 6, `expected 6 calls after window reset, got ${calls}`);

  console.log('all tests passed');
}

runSelfTest();

runSelfTest();
