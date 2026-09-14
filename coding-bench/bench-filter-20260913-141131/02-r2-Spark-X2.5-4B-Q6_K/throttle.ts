import assert from 'node:assert';

export function throttle(
  fn: () => void,
  maxPerWindow: number,
  windowMs: number,
): () => void {
  let lastCall = 0;
  let count = 0;

  return function throttled(...args: unknown[]): void {
    const now = Date.now();
    // Reset the window and counter whenever the window elapses
    if (now - lastCall >= windowMs) {
      lastCall = now;
      count = 0;
    }
    // Skip any call that is not within the per-window limit
    if (count >= maxPerWindow) {
      return;
    }
    count++;
    fn(...args);
  };
}

async function main(): Promise<void> {
  const calls: number[] = [];
  const throttled = throttle(
    (...args: unknown[]) => {
      calls.push(Date.now());
    },
    5,
    1000,
  );

  // First window: 10 rapid calls, only maxPerWindow (5) should fire
  for (let i = 0; i < 10; i++) {
    throttled();
  }
  assert.strictEqual(calls.length, 5, 'expected exactly 5 calls within the first window');

  // Wait for the window to elapse
  await new Promise((resolve) => setTimeout(resolve, 1001));

  // Second window: all calls should fire again
  for (let i = 0; i < 10; i++) {
    throttled();
  }
  assert.strictEqual(calls.length, 10, 'expected 5 calls per window, total 10');

  console.log('all tests passed');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
