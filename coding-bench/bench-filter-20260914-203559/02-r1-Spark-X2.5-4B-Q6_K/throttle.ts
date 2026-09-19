import assert from 'node:assert';

/**
 * Returns a wrapper around fn that calls fn at most `maxPerWindow` times per
 * `windowMs` window, silently skipping excess calls.
 */
export function throttle(
  fn: () => void,
  maxPerWindow: number,
  windowMs: number
): () => void {
  let lastWindowStart = 0;
  let countInWindow = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;

  return function throttled(): void {
    const now = Date.now();

    // Start a fresh window if it has expired.
    if (now - lastWindowStart >= windowMs) {
      lastWindowStart = now;
      countInWindow = 0;
    }

    // Exceed the limit: skip this call and schedule the window to reset.
    if (countInWindow >= maxPerWindow) {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        countInWindow = 0;
        timer = null;
      }, windowMs);
      return;
    }

    // Allow this call.
    countInWindow++;
    fn();
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      countInWindow = 0;
      timer = null;
    }, windowMs);
  };
}

async function selfTest(): Promise<void> {
  let calls = 0;
  let lastCall = 0;

  const throttled = throttle(
    () => {
      calls++;
      lastCall = Date.now();
    },
    2,
    100
  );

  // Window is 100ms; fire 5 calls well within the window.
  throttled();
  throttled();
  throttled();
  throttled();
  throttled();

  assert.strictEqual(calls, 2, 'should only allow 2 calls within the window');

  await new Promise((resolve) => setTimeout(resolve, 250));

  calls = 0;
  throttled();
  throttled();

  assert.strictEqual(calls, 2, 'should allow 2 calls after the window resets');

  // Verify silent skipping: with maxPerWindow = 1, the 2nd call must be skipped.
  calls = 0;
  const one = throttle(
    () => {
      calls++;
    },
    1,
    100
  );
  one();
  one();
  assert.strictEqual(calls, 1, 'excess calls must be silently skipped');

  console.log('all tests passed');
}

selfTest().catch((err) => {
  console.error(err);
  process.exit(1);
});
