export function throttle(fn: () => void, maxPerWindow: number, windowMs: number): () => void {
  const timestamps = [];

  return function () {
    const now = Date.now();
    // Remove timestamps outside the window
    timestamps = timestamps.filter(t => now - t < windowMs);
    if (timestamps.length < maxPerWindow) {
      fn();
      timestamps.push(now);
    }
  };
}

// Self-test
if (require.main === module) {
  const maxPerWindow = 5;
  const windowMs = 1000; // 1 second for testing
  
  let callCount = 0;
  const wrapped = throttle(() => {
    callCount++;
    console.log(`Call #${callCount}`);
  }, maxPerWindow, windowMs);

  // Make 7 calls rapidly (should only allow 5)
  for (let i = 0; i < 7; i++) {
    wrapped();
  }

  console.log(`Total calls made: ${callCount}`);
  // Expected: 5 calls
  if (callCount === 5) {
    console.log('Self-test passed');
  } else {
    console.error('Self-test failed');
    process.exit(1);
  }
}
