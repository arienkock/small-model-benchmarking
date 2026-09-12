// throttle.ts — Throttle function that limits calls to a maximum number per window.

/**
 * Returns a wrapper that calls `fn` at most `maxPerWindow` times per `windowMs`.
 * Excess calls are silently skipped.
 *
 * @param fn - The function to throttle.
 * @param maxPerWindow - Maximum number of calls allowed in the window.
 * @param windowMs - Window size in milliseconds.
 * @returns A throttled version of `fn`.
 */
export function throttle(fn: () => void, maxPerWindow: number, windowMs: number): () => void {
  let calls = 0;
  const windowStart = Date.now();

  return function (...args: any[]) {
    const now = Date.now();

    // If we're still within the current window, check if we've hit the limit
    if (now - windowStart < windowMs) {
      if (calls >= maxPerWindow) {
        // Skip this call
        return;
      }
      // Increment the call count
      calls++;
    } else {
      // Window has expired, reset the counter
      calls = 0;
      windowStart = now;
    }

    fn(...args);
  };
}

// Self-test: verify the throttle function works correctly.
// Run with: node throttle.ts

const test = () => {
  const throttled = throttle(() => {
    // Simple counter to track how many times the function was called
    let callCount = 0;
    throttled();
    return callCount;
  }, 5, 1000);

  // Call the throttled function 7 times quickly
  for (let i = 0; i < 7; i++) {
    throttled();
  }

  // The first 5 calls should succeed, the 6th should be skipped
  // The 7th should also be skipped
  console.log("\nTest completed. If the output shows only 5 calls, the throttle works correctly.");
};

test();
