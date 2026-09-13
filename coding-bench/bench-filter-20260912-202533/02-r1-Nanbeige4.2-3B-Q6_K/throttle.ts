import { pathToFileURL } from 'node:url';

export function throttle(fn: () => void, maxPerWindow: number, windowMs: number): () => void {
  let requestsInWindow = 0;
  let lastReset = 0;

  return function () {
    const now = Date.now();
    if (now - lastReset > windowMs) {
      requestsInWindow = 0;
      lastReset = now;
    }

    if (requestsInWindow >= maxPerWindow) {
      return; // silently skip excess calls
    }

    requestsInWindow += 1;
    fn();
  };
}

// --- Self-test ---
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  // Test 1: 5 calls within 2 seconds, max 3 per window → fn called 3 times
  const throttled = throttle(() => {
    console.log("fn called");
  }, 3, 2000);

  throttled();
  throttled();
  throttled();
  throttled();
  throttled();

  const calls = [];
  const realFn1 = () => calls.push(Date.now());
  const t1 = throttle(realFn1, 2, 100);

  t1(); t1(); t1(); t1(); t1(); t1(); // 7 calls, max 2 per 100ms

  if (calls.length !== 2) {
    throw new Error(`Expected 2 calls, got ${calls.length}`);
  }

  // Test 2: Reset window and call again → should allow calls again
  const calls2 = [];
  const realFn2 = () => calls2.push(Date.now());
  const t2 = throttle(realFn2, 2, 100);
  t2(); t2(); t2(); // 3 calls within window → fn called 2 times
  if (calls2.length !== 2) {
    throw new Error(`Expected 2 calls after reset, got ${calls2.length}`);
  }

  console.log("throttle self-test passed");
}
