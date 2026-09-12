// throttle.ts - Throttle function that limits calls to maxPerWindow times per windowMs

import { EventEmitter } from "node:events";

/**
 * Returns a throttled version of the given function.
 * The function will be called at most `maxPerWindow` times within `windowMs`
 * milliseconds. Excess calls are silently skipped.
 *
 * @param fn - The function to throttle
 * @param maxPerWindow - Maximum number of calls allowed in the window
 * @param windowMs - Time window in milliseconds
 * @returns A throttled function that wraps `fn`
 */
export function throttle(fn: () => void, maxPerWindow: number, windowMs: number): () => void {
  let calls = 0;
  const windowStart = Date.now();
  const max = maxPerWindow;
  const window = windowMs;

  return function (...args: any[]) {
    const now = Date.now();

    // If we're still within the current window and have reached the limit,
    // skip this call.
    if (now - windowStart < window) {
      if (calls >= max) {
        // Skip the call
        return;
      }
      // Increment call count
      calls++;
    } else {
      // Window has expired, reset the counter
      calls = 0;
      windowStart = now;
    }

    // Call the function
    fn(...args);
  };
}

// Self-test
if (import.meta.url === `file://${process.argv[1]}`) {
  // Test the throttle function
  const throttled = throttle(() => {
    console.log("Throttled function called");
  }, 5, 1000); // 5 calls per 1 second

  let calls = 0;
  const start = Date.now();

  // Call the throttled function 7 times quickly
  for (let i = 0; i < 7; i++) {
    throttled();
    calls++;
    if (i === 0) {
      console.log(`Call #${calls} at ${new Date().toISOString()}`);
    }
  }

  const elapsed = Date.now() - start;
  console.log(`Total calls: ${calls}`);
  console.log(`Elapsed time: ${elapsed}ms`);

  // Verify that only 5 calls were actually made (the 6th and 7th were skipped)
  if (calls <= 5) {
    console.log("✓ Throttle test passed: only 5 calls were made (rate limited)");
    process.exit(0);
  } else {
    console.log("✗ Throttle test failed: more than 5 calls were made");
    process.exit(1);
  }
}
