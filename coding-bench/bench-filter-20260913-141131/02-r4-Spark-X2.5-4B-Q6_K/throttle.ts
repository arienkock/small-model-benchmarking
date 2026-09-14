/**
 * throttle(fn, maxPerWindow, windowMs)
 *
 * Returns a wrapper that calls `fn` at most `maxPerWindow` times per
 * `windowMs`. Excess calls within the window are silently skipped.
 */

import { pathToFileURL } from "node:url";

export function throttle(fn: () => void, maxPerWindow: number, windowMs: number): () => void {
  let windowStart = Date.now();
  let countInWindow = 0;

  return function throttled(): void {
    const now = Date.now();

    // A new window starts when the current one has elapsed.
    if (now >= windowStart + windowMs) {
      windowStart = now;
      countInWindow = 0;
    }

    // Silently skip any call that would exceed the per-window limit.
    if (countInWindow >= maxPerWindow) {
      return;
    }

    countInWindow += 1;
    fn();
  };
}

/**
 * Brief self-test. Run with: node throttle.ts
 */
function selfTest(): void {
  let calls = 0;

  const fn = (): void => {
    calls++;
  };

  const throttled = throttle(fn, 2, 1000);

  // --- Within a single window: at most maxPerWindow calls are allowed. ---
  throttled();
  throttled();
  throttled(); // skipped (3rd call)
  throttled(); // skipped (4th call)

  if (calls !== 2) {
    console.error(`self-test failed: expected 2 calls, got ${calls}`);
    process.exit(1);
  }

  // --- Advance well past the window boundary: the counter resets. ---
  const waitMs = 1000;
  const wait = new Promise<void>((resolve) => {
    setTimeout(resolve, waitMs);
  });

  (async () => {
    await wait;

    throttled(); // allowed (window reset)
    throttled(); // allowed (2nd in new window)
    throttled(); // skipped
    throttled(); // skipped

    if (calls !== 4) {
      console.error(`self-test failed: expected 4 calls, got ${calls}`);
      process.exit(1);
    }
    console.log("self-test passed");
  })();
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  selfTest();
}
