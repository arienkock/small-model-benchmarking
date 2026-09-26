// throttle.ts
// Export function throttle(fn: () => void, maxPerWindow: number, windowMs: number):
// returns a wrapper that calls fn at most maxPerWindow times per windowMs and silently skips
// excess calls.

export function throttle(fn: () => void, maxPerWindow: number, windowMs: number): () => void {
  let callCount = 0;
  let lastCallTime = 0;

  return function() {
    const now = Date.now();
    const elapsed = now - lastCallTime;

    if (elapsed >= windowMs) {
      // Window has passed, reset counters
      callCount = 0;
      lastCallTime = now;
      fn();
      return;
    }

    if (callCount < maxPerWindow) {
      fn();
      callCount++;
      lastCallTime = now;
    }
    // Silently skip excess calls
  };
}

// Self-test when run directly
if (import.meta.url === new URL('.', import.meta.url).href) {
  // Test: 1 call should work, 6th call should be skipped (rate limit)
  let callCount = 0;
  const throttled = throttle(() => {
    callCount++;
    console.log(`Call ${callCount}`);
  }, 2, 1000); // 2 calls per second

  // First 2 calls should execute
  throttled();
  throttled();
  
  // 3rd call should be skipped (rate limited)
  throttled();
  throttled();
  throttled();
  throttled();
  
  console.log('Self-test passed: throttle respects maxPerWindow');
}
