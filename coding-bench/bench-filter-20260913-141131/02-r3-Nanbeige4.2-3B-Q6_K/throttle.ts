export function throttle(fn: () => void, maxPerWindow: number, windowMs: number): () => void {
  let requests: number[] = [];

  return function throttled() {
    const now = Date.now();
    const windowStart = now - windowMs;

    // Remove timestamps outside the current window
    requests = requests.filter((ts) => ts >= windowStart);

    if (requests.length >= maxPerWindow) {
      // Excess call — silently skip
      return;
    }

    requests.push(now);
    fn();
  };
}

// --- Self-test ---
import { pathToFileURL } from 'node:url';
import assert from 'node:assert';

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  let callCount = 0;
  const throttled = throttle(() => {
    callCount++;
  }, 3, 500); // max 3 calls per 500ms

  // Call 5 times rapidly — only first 3 should execute
  throttled();
  throttled();
  throttled();
  throttled();
  throttled();

  assert.strictEqual(callCount, 3, `Expected 3 calls, got ${callCount}`);

  // Wait beyond the window and call again — window is empty, both should execute
  await new Promise((resolve) => setTimeout(resolve, 600));
  throttled();
  throttled();

  assert.strictEqual(callCount, 5, `Expected 5 calls after window reset, got ${callCount}`);

  console.log('all tests passed');
}
