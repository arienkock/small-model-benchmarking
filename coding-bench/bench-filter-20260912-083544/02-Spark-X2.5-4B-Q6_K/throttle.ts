/**
 * throttle(fn, maxPerWindow, windowMs)
 *
 * Returns a wrapper around `fn` that calls `fn` at most `maxPerWindow` times
 * per `windowMs` window and silently skips any excess calls.
 */

export function throttle<T extends (...args: any[]) => void>(
  fn: T,
  maxPerWindow: number,
  windowMs: number
): T {
  let last = 0;
  let count = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const resetWindow = () => {
    timer = null;
    count = 0;
    last = 0;
  };

  return function (this: unknown, ...args: Parameters<T>): void {
    const now = Date.now();

    // Reset the window if it has fully elapsed.
    if (now - last >= windowMs) {
      last = now;
      count = 0;
    }

    count += 1;

    // Over the limit: skip the call and wait for the window to reset.
    if (count > maxPerWindow) {
      if (timer) clearTimeout(timer);
      timer = setTimeout(resetWindow, windowMs);
      return;
    }

    fn.apply(this, args);

    if (timer) clearTimeout(timer);
    if (now - last < windowMs) {
      timer = setTimeout(resetWindow, windowMs - (now - last));
    }
  };
}

// --- Self-test -------------------------------------------------------------

const calls: number[] = [];
let failures = 0;

function assert(cond: boolean, msg: string): void {
  if (cond) {
    console.log("ok  -", msg);
  } else {
    failures += 1;
    console.error("FAIL -", msg);
  }
}

// 5 calls per 1000ms window; all should fire.
let t = 0;
const fired: number[] = [];
const fn = throttle(
  () => fired.push(t++),
  5,
  1000
);

for (let i = 0; i < 5; i++) {
  fn();
}
assert(fired.length === 5, `5 calls fired within the window (got ${fired.length})`);

// 10 more calls within the same window must be silently skipped.
for (let i = 0; i < 10; i++) {
  fn();
}
assert(fired.length === 5, `only 5 calls fired (no over-limit skips) (got ${fired.length})`);

// A fresh window: after 1000ms + a bit, the next call should be allowed again.
fn();
assert(fired.length === 6, `6th call in the next window fires (got ${fired.length})`);

// Verify Retry-After-style timing: maxPerWindow=1, windowMs=50 -> after one
// fire, the next fire must be delayed by the remaining window.
const t2 = 0;
const fired2: number[] = [];
let fn2: () => void = throttle(
  () => fired2.push(t2++),
  1,
  50
);
fn2();
fn2(); // skipped
fn2(); // skipped (window not reset)
fn2(); // still skipped
fn2(); // still skipped
fn2(); // still skipped
fn2(); // still skipped
fn2(); // still skipped
fn2(); // still skipped
fn2(); // still skipped
fn2(); // still skipped
fn2(); // still skipped
fn2(); // still skipped
fn2(); // still skipped
fn2(); // still skipped
fn2(); // still skipped
fn2(); // still skipped
fn2(); // still skipped
assert(fired2.length === 1, `exactly 1 fire per 1-per-window (got ${fired2.length})`);

if (failures > 0) {
  console.error(`${failures} test(s) failed`);
  process.exit(1);
}

console.log("All self-tests passed.");
