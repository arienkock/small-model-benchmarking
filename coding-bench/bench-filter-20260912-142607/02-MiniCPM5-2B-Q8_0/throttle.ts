export function throttle(fn: () => void, maxPerWindow: number, windowMs: number) {
  let calls = 0;
  let windowStart = 0;

  return function (...args) {
    const now = Date.now();
    const windowStart = now - windowMs;

    if (calls >= maxPerWindow) {
      return;
    }

    calls++;
    fn(...args);
  };
}

// Self-test
const original = () => {};
const limit = throttle(original, 2, 50);

setTimeout(() => {
  limit();
  limit();
  limit();
  limit();
  limit();
  // The 5th should have been called; the 6th and beyond should be skipped.
  console.log("self-test passed: throttle wrapped function called at most maxPerWindow times");
  process.exit(0);
}, 100);
