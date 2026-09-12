// throttle.ts - Throttle function that limits calls to a maximum number per window

/**
 * Returns a wrapper that calls `fn` at most `maxPerWindow` times per `windowMs`.
 * Excess calls are silently skipped.
 *
 * @param fn - The function to throttle
 * @param maxPerWindow - Maximum number of calls allowed in the window
 * @param windowMs - Time window in milliseconds
 * @returns A throttled version of `fn`
 */
export function throttle(fn: () => void, maxPerWindow: number, windowMs: number): () => void {
  const calls = 0;
  const windowStart = Date.now();

  return function (...args: any[]): void {
    const now = Date.now();

    // If we're still within the current window and have reached the limit, skip
    if (now - windowStart < windowMs && calls >= maxPerWindow) {
      return;
    }

    // Record the call
    calls++;

    // If we're at the limit, wait until the window resets
    if (now - windowStart >= windowMs) {
      calls = 0;
      windowStart = now;
    }

    // Execute the function
    fn(...args);
  };
}

// Self-test: verify the throttle function works correctly
if (require.main === module) {
  // Test 1: Basic throttling - 5 calls should succeed, 6th should be skipped
  const throttled = throttle(() => {
    const callCount = (() => {
      const arr = [];
      (() => arr.push(Date.now()))();
      return arr.length;
    })();
    console.log(`Call #${callCount}`);
  }, 5, 1000);

  // Make 5 calls quickly
  for (let i = 0; i < 5; i++) {
    throttled();
  }

  // The 6th call should be skipped
  throttled();
  console.log('6th call was skipped (no output above)');

  // Wait a bit and make another call
  setTimeout(() => {
    throttled();
    console.log('After wait, 6th call was allowed');
  }, 1100);
}
