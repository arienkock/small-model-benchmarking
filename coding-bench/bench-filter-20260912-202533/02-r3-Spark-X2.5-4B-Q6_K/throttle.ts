/**
 * Throttle a function so it runs at most `maxPerWindow` times per `windowMs`.
 * Excess calls within the window are silently skipped.
 */

type ThrottleOptions = {
  /** Maximum number of times `fn` may be invoked within one window. */
  maxPerWindow: number;
  /** Window length in milliseconds. */
  windowMs: number;
};

type ThrottleFn<T> = (...args: Parameters<T>) => void;

export function throttle<T extends (...args: any[]) => any>(
  fn: T,
  options: ThrottleOptions,
): ThrottleFn<T> {
  let lastCall = 0;
  let countInWindow = 0;

  return (...args: Parameters<T>): void => {
    const now = Date.now();
    const window = options.windowMs;
    const max = options.maxPerWindow;

    if (now - lastCall >= window) {
      // Window reset: start a fresh window and allow the first call.
      lastCall = now;
      countInWindow = 1;
      if (countInWindow <= max) {
        fn(...args);
      }
      return;
    }

    countInWindow += 1;
    if (countInWindow > max) {
      // Silently skip excess calls within the window.
      return;
    }
    fn(...args);
  };
}

// Self-test: runnable via `node throttle.ts`.
import { throttle as throttleFn } from './throttle.ts';

async function runSelfTest(): Promise<void> {
  let calls = 0;

  const fn = (...args: number[]): void => {
    calls += 1;
  };

  const t = throttleFn(fn, { maxPerWindow: 2, windowMs: 1000 });

  // First two calls are allowed; the rest within the window are skipped.
  t(1);
  t(2);
  t(3);
  t(4);
  t(5);

  // After the window resets, the next two calls are allowed again.
  const timer = setInterval(() => {
    t(3);
    t(4);
    clearInterval(timer);
  }, 1000);

  await new Promise((resolve) => setTimeout(resolve, 1100));

  console.log(`total calls: ${calls}`);

  if (calls !== 4) {
    throw new Error(`Expected 4 calls, got ${calls}`);
  }
  console.log('all tests passed');
}

runSelfTest();
