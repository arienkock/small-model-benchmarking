// throttle.ts
// export function throttle(fn: () => void, maxPerWindow: number, windowMs: number): () => void
export function throttle(fn: () => void, maxPerWindow: number, windowMs: number): () => void {
  const calls: number[] = []; // timestamps in ms

  return function() {
    const now = Date.now();
    // Count how many calls are within the window
    let count = calls.filter(t => now - t <= windowMs).length;
    if (count >= maxPerWindow) {
      // Skip this call
      return;
    }
    // Record this call
    calls.push(now);
    // Execute the function
    fn();
  };
}

// Self-test
function selfTest() {
  let callCount = 0;
  const max = 2;
  const window = 1000; // 1 second window

  const throttled = throttle(() => { callCount++; }, max, window);

  // Make 5 calls quickly
  for (let i = 0; i < 5; i++) {
    throttled();
  }

  // After the window, we should have called fn exactly max times
  if (callCount === max) {
    console.log('Self-test passed');
    process.exit(0);
  } else {
    console.error('Self-test failed: expected', max, 'calls, got', callCount);
    process.exit(1);
  }
}

if (require('fs').existsSync('./throttle.ts')) {
  // This is the self-test block; we don't want to run it twice.
  // Actually we just run the self-test when the file is executed directly.
  selfTest();
}