/**
 * throttle — rate-limit a function call.
 *
 * @param fn      The function to call (must be () => void).
 * @param maxPerWindow Maximum number of times fn may be called within a window.
 * @param windowMs   Duration of the rate-limit window in milliseconds.
 * @returns A wrapper function that calls fn at most maxPerWindow times per windowMs;
 *          excess calls are silently skipped.
 */
export function throttle(fn: () => void, maxPerWindow: number, windowMs: number): () => void {
    let calls = 0;
    let lastReset: number | null = null;

    return function () {
        const now = Date.now();
        if (lastReset === null || now - lastReset >= windowMs) {
            calls = 0;
            lastReset = now;
        }

        if (calls >= maxPerWindow) {
            // Silently skip excess calls
            return;
        }

        calls++;
        fn?.();
    };
}

/**
 * Self-test: verify throttle behaves correctly when run with `node throttle.ts`.
 */
import { pathToFileURL } from 'node:url';
import assert from 'node:assert';

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
    // Test 1: 7 rapid calls with max 3 per 100ms → only 3 should execute
    let callCount = 0;
    const wrapped = throttle(() => {
        callCount++;
    }, 3, 100);

    for (let i = 0; i < 7; i++) {
        wrapped();
    }

    assert.strictEqual(callCount, 3, `Test 1 failed: expected 3 calls, got ${callCount}`);
    console.log('PASS: Test 1 — throttle limited 7 rapid calls to 3');

    // Test 2: Window resets — max 2 per 500ms, then 2 more within new window
    callCount = 0;
    const wrapped2 = throttle(() => {
        callCount++;
    }, 2, 500);

    // First window: 2 calls within 500ms
    wrapped2();
    wrapped2();

    // Wait for window to reset (500ms)
    await new Promise(resolve => setTimeout(resolve, 500));

    // Second window: 2 more calls
    wrapped2();
    wrapped2();

    assert.strictEqual(callCount, 4, `Test 2 failed: expected 4 calls, got ${callCount}`);
    console.log('PASS: Test 2 — window reset works correctly');

    console.log('All tests passed');
}
