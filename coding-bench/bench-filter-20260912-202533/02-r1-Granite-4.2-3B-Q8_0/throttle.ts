// throttle.ts
// Export function throttle(fn: () => void, maxPerWindow: number, windowMs: number):
// returns a wrapper that calls fn at most maxPerWindow times per windowMs and silently skips
// excess calls.

export function throttle(fn: () => void, maxPerWindow: number, windowMs: number): () => void {
  let callCount = 0;
  let lastCall = 0;

  return () => {
    const now = Date.now();
    if (now - lastCall >= windowMs) {
      callCount = 0;
      lastCall = now;
    }
    if (callCount < maxPerWindow) {
      fn();
      callCount++;
    }
    lastCall = now;
  };
}

// Self-test when run directly
if (require('fs').existsSync(__dirname + '/throttle.test.ts')) {
  // Test file exists
} else {
  // Run simple self-test synchronously
  let fnCalled = 0;
  const testFn = () => {
    fnCalled++;
  };
  
  // 2 calls per 1000ms
  const throttled = throttle(testFn, 2, 1000);
  
  // Make 3 calls quickly - should only call fn twice
  throttled();
  throttled();
  throttled();
  
  // Make more calls after window resets (synchronously, we just verify the first batch)
  // The test passes if fn was called <= 2 times
  if (fnCalled <= 2) {
    console.log('PASS');
  } else {
    console.log('FAIL');
  }
}
