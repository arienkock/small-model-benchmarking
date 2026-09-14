/**
 * Throttle a function so it runs at most `maxPerWindow` times per
 * `windowMs` window, silently skipping excess calls.
 */

export function throttle(
  fn: () => void,
  maxPerWindow: number,
  windowMs: number
): () => void {
  let lastCall = 0;
  let count = 0;

  return function throttled(...args: unknown[]): void {
    const now = Date.now();
    const elapsedMs = now - lastCall;

    // Window has elapsed: reset the counter and start a fresh window.
    if (elapsedMs >= maxPerWindow * windowMs) {
      count = 0;
      lastCall = now;
    }

    // Skip any calls that exceed the limit inside the current window.
    if (count >= maxPerWindow) {
      return;
    }

    count += 1;
    lastCall = now;
    fn(...args);
  };
}

import assert from 'node:assert';

function selfTest(): Promise<void> {
  let calls = 0;
  const fn = (): void => {
    calls += 1;
  };

  // 2 calls allowed per 1s window; 6 rapid calls -> 2 should run.
  const wrapper = throttle(fn, 2, 1000);
  for (let i = 0; i < 6; i += 1) {
    wrapper();
  }
  assert.strictEqual(calls, 2, `expected 2 calls, got ${calls}`);

  // Window resets after `maxPerWindow` calls once the window elapses.
  let calls2 = 0;
  const fn2 = (): void => {
    calls2 += 1;
  };
  // maxPerWindow=2: 1st and 2nd calls run, 3rd skipped.
  const wrapper2 = throttle(fn2, 2, 50);
  wrapper2();
  wrapper2();
  wrapper2(); // third call skipped
  return new Promise((resolve) => {
    setTimeout(() => {
      wrapper2(); // window elapsed: fresh window starts
      assert.strictEqual(calls2, 3, `expected 3 calls, got ${calls2}`);
      resolve();
    }, 100);
  });
}

selfTest().then(
  () => console.log('throttle self-test passed'),
  (err) => {
    console.error('throttle self-test failed:', err);
    process.exit(1);
  }
);
