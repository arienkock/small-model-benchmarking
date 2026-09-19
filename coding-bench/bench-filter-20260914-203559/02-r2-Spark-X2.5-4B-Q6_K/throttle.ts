/**
 * Throttle a function so it is called at most `maxPerWindow` times per
 * `windowMs`, silently skipping excess calls.
 *
 * @param fn        The function to throttle.
 * @param maxPerWindow  Maximum number of calls allowed per window.
 * @param windowMs  Size of the window in milliseconds.
 * @returns A wrapper function that throttles `fn`.
 */
export function throttle(fn: () => void, maxPerWindow: number, windowMs: number): () => void {
  let lastCallTime = 0;
  let callCount = 0;

  return function throttled(...args: unknown[]): void {
    const now = Date.now();

    // A new window has started: reset the count and last call time.
    if (now - lastCallTime >= windowMs) {
      callCount = 0;
      lastCallTime = now;
    }

    // If we've already made the allowed number of calls for this window,
    // silently skip this excess call.
    if (callCount >= maxPerWindow) {
      return;
    }

    // Make the call.
    lastCallTime = now;
    callCount += 1;
    fn(...args);
  };
}

// --- Self-test ---
function selfTest(): void {
  let calls = 0;
  const fn = () => {
    calls += 1;
  };

  const wrapped = throttle(fn, 3, 1000);

  // Burst: more calls than allowed within the window.
  wrapped();
  wrapped();
  wrapped(); // allowed
  wrapped(); // skipped (4th)
  wrapped(); // skipped (5th)

  if (calls !== 3) {
    console.error(`self-test failed: expected 3 calls, got ${calls}`);
    process.exit(1);
  }

  // Wait for the window to elapse, then verify the count resets.
  setTimeout(() => {
    wrapped(); // allowed (4th overall)
    wrapped(); // allowed (5th overall)
    wrapped(); // allowed (6th overall)
    wrapped(); // skipped (7th)

    if (calls !== 6) {
      console.error(`self-test failed: expected 6 calls, got ${calls}`);
      process.exit(1);
    }

    console.log("all tests passed");
  }, 1100);
}

// Run the self-test when executed directly.
if (import.meta.url === `file://${process.argv[1]}`) {
  selfTest();
}
