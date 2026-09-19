// throttle.ts
// Export function throttle(fn: () => void, maxPerWindow: number, windowMs: number): () => void
// Returns a wrapper that calls fn at most maxPerWindow times per windowMs
// Silently skips excess calls.

export function throttle(fn: () => void, maxPerWindow: number, windowMs: number): () => void {
  const callTimes: number[] = [];

  return function () {
    const now = Date.now();
    // Keep only timestamps within the current window
    const recent = callTimes.filter(t => now - t <= windowMs);
    if (recent.length < maxPerWindow) {
      fn();
      callTimes.push(now);
    }
    // else: silently skip the call
  };
}

// Self-test when run directly
if (import.meta.url === new URL('.', import.meta.url).href) {
  const max = 2;
  const window = 1000; // 1 second window
  let fnCallCount = 0;
  const originalFn = () => {
    fnCallCount++;
  };
  const throttled = throttle(originalFn, max, window);

  // Call the throttled function many times
  for (let i = 0; i < 10; i++) {
    throttled();
  }

  // Should have called fn at most max times
  if (fnCallCount > max) {
    console.error('Self-test failed: fn was called more than maxPerWindow times');
    process.exit(1);
  } else {
    console.log('Self-test passed');
    process.exit(0);
  }
}
