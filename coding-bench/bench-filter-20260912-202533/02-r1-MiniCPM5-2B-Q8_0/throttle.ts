export function throttle(fn: () => void, maxPerWindow: number, windowMs: number): () => void {
  let calls = 0;
  let windowStart = 0;

  return function () {
    const now = Date.now();
    const windowStart = now - windowMs;

    if (calls >= maxPerWindow) {
      return;
    }

    calls += 1;
    fn();
  };
}

// Self-test: run with `node throttle.ts`
const originalFn = () => {
  console.log("fn called");
};

// Track calls manually since functions don't expose call counts
const wrapped = throttle(originalFn, 5, 60_000);
let callCount = 0;

// We'll wrap the originalFn to count calls
const countingFn = () => {
  callCount += 1;
  originalFn();
};

const throttled = throttle(countingFn, 5, 60_000);

// Simulate 6 calls
for (let i = 0; i < 6; i++) {
  throttled();
}

console.log(`Throttled calls: ${callCount}`);

// Expect 5 calls (the 6th is skipped)
if (callCount === 5) {
  console.log("self-test passed");
  process.exit(0);
} else {
  console.log(`self-test FAILED: expected 5, got ${callCount}`);
  process.exit(1);
}
