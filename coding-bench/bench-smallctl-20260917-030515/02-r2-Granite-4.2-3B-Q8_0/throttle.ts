import assert from 'node:assert';

/**
 * Throttle a function to be called at most maxPerWindow times per windowMs.
 * Calls fn() at most maxPerWindow times within windowMs milliseconds.
 * Excess calls are silently skipped.
 *
 * @param fn - Function to throttle.
 * @param maxPerWindow - Maximum number of calls allowed in the window.
 * @param windowMs - Window size in milliseconds.
 * @returns A wrapper function that respects the rate limit.
 */
export function throttle(fn: () => void, maxPerWindow: number, windowMs: number): () => void {
  let lastCallTime = 0;
  let callCount = 0;

  return function () {
    const now = Date.now();
    const elapsed = now - lastCallTime;

    // If we're outside the window, reset counters
    if (elapsed >= windowMs) {
      lastCallTime = now;
      callCount = 0;
    }

    // Check if we can call the function
    if (callCount < maxPerWindow) {
      fn();
      callCount++;
      lastCallTime = now;
    }
    // Otherwise, silently skip
  };
}

// Self-test
if (import.meta.url === new URL('.', import.meta.url).href) {
  // Simple self-test: verify the function exists and can be imported
  const testFn = () => {
    console.log('test');
  };
  const throttled = throttle(testFn, 3, 1000);
  throttled();
  throttled();
  throttled();
  throttled(); // should be skipped
  throttled(); // should be skipped
  console.log('Self-test passed');
}
