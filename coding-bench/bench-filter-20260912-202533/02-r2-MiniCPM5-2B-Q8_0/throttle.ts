export function throttle(fn: () => void, maxPerWindow: number, windowMs: number) {
  let count = 0;
  let windowStart = 0;

  return function wrapped() {
    const now = Date.now();
    if (now - windowStart >= windowMs) {
      windowStart = now;
      count = 0;
    }
    if (count >= maxPerWindow) {
      return;
    }
    count++;
    fn();
  };
}

// Self-test
const calls = [];
const original = () => calls.push(Date.now());
const throttled = throttle(original, 2, 1000);

throttled();
throttled();
throttled();

console.log("Calls:", calls.length);
if (calls.length === 2) {
  console.log("self-test passed");
  process.exit(0);
} else {
  console.log("self-test failed");
  process.exit(1);
}
