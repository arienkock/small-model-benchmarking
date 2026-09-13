export function throttle<T extends (...args: any[]) => void>(
  fn: T,
  maxPerWindow: number,
  windowMs: number
): (...args: Parameters<T>) => void {
  let lastCall = 0;
  let count = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const now = (): number => Date.now();
  const toMs = (sec: number): number => Math.max(0, Math.round(sec * 1000));

  return (...args: Parameters<T>): void => {
    const current = now();
    const elapsedSec = (current - lastCall) / 1000;

    // If the window has elapsed, start a fresh window.
    if (elapsedSec >= windowMs / 1000) {
      lastCall = current;
      count = 0;
    }

    // Skip if we've already called fn maxPerWindow times in this window.
    if (count >= maxPerWindow) {
      return;
    }

    count++;
    lastCall = current;
    fn(...args);

    // Schedule the next allowed call for this window.
    if (count < maxPerWindow) {
      const remainingSec = windowMs / 1000 - (current - lastCall) / 1000;
      timer = setTimeout(() => {
        timer = null;
        count = 0;
        lastCall = now();
      }, toMs(remainingSec));
    }
  };
}

// Self-test (run only when executed directly as `node throttle.ts`).
import assert from 'node:assert';
import { pathToFileURL } from 'node:url';

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  let totalCalls = 0;

  function countingFn(x: number): void {
    totalCalls++;
  }

  const throttleFn = throttle(countingFn, 2, 1000);

  // First window: allow maxPerWindow calls, skip the rest.
  throttleFn(1);
  throttleFn(2);
  throttleFn(3);
  throttleFn(4);

  assert.strictEqual(totalCalls, 2, 'window 1: expected exactly 2 calls');

  // Wait for the window to expire so a new window begins.
  await new Promise((r) => setTimeout(r, 1100));

  // New window: allow a fresh batch of maxPerWindow calls.
  throttleFn(5);
  throttleFn(6);
  throttleFn(7);

  assert.strictEqual(totalCalls, 4, 'window 2: expected exactly 2 calls');

  console.log('throttle self-test passed');
}
