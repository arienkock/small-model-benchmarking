export function throttle(fn: () => void, maxPerWindow: number, windowMs: number): () => void {
  const timestamps: number[] = [];

  return function wrapped() {
    const now = performance.now();
    const cutoff = now - windowMs;

    timestamps = timestamps.filter((t) => t > cutoff);

    if (timestamps.length >= maxPerWindow) {
      return; // silently skip excess calls
    }

    timestamps.push(now);
    fn();
  };
}

// Self-test
const startMs = Date.now();

const limiter = throttle(() => {
  console.log("fn called");
}, 2, 50);

limiter();
limiter();
limiter();
limiter();
// 6th call should be skipped silently

console.log(`Self-test complete. Total time: ${Date.now() - startMs}ms`);
