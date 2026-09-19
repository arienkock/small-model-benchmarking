import assert from 'node:assert';
import { pathToFileURL } from 'node:url';

/**
 * Returns a wrapper around `fn` that calls it at most `maxPerWindow` times
 * per `windowMs`. Excess calls are silently skipped.
 */
export function throttle(
  fn: () => void,
  maxPerWindow: number,
  windowMs: number
): () => void {
  let timestamps: number[] = [];

  return function throttled(...args: unknown[]): void {
    const now = Date.now();

    // Drop timestamps outside the current sliding window.
    timestamps = timestamps.filter((t) => now - t <= windowMs);

    if (timestamps.length >= maxPerWindow) {
      // Silently skip excess calls.
      return;
    }

    timestamps.push(now);
    fn();
  };
}

function selfTest(): void {
  const calls: number[] = [];
  let count = 0;

  const throttled = throttle(
    () => {
      count++;
      calls.push(count);
    },
    2,
    1000
  );

  // First two calls within the window are allowed; the rest are skipped.
  throttled();
  throttled();
  throttled();
  throttled();
  throttled();

  assert.strictEqual(calls.length, 2, 'expected 2 calls in the first window');
  assert.strictEqual(calls[0], 1, 'first call should be call #1');
  assert.strictEqual(calls[1], 2, 'second call should be call #2');

  // Wait for the window to elapse so the next window allows new calls.
  setTimeout(() => {
    throttled();
    throttled();
    throttled();

    assert.strictEqual(calls.length, 4, 'expected 4 calls total after window reset');
    console.log('all tests passed');
  }, 1100);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  selfTest();
}
