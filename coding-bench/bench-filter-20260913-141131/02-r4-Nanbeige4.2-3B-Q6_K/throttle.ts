/**
 * throttle(fn, maxPerWindow, windowMs)
 * Returns a wrapper that calls fn at most maxPerWindow times per windowMs
 * and silently skips excess calls.
 */
export function throttle(fn: () => void, maxPerWindow: number, windowMs: number): () => void {
    let calls: number[] = [];

    return function () {
        const now = Date.now();
        // Clean up timestamps outside the window
        calls = calls.filter((ts) => now - ts < windowMs);

        if (calls.length >= maxPerWindow) {
            // Silently skip — do not call fn
            return;
        }

        calls.push(now);
        fn();
    };
}

// ---- Self-test ----
import assert from 'node:assert';

let fnInvocationCount = 0;
let wrapperInvocationCount = 0;

const fn = () => {
    fnInvocationCount++;
};

const throttled = throttle(fn, 3, 100); // max 3 calls per 100ms

// Phase 1: exceed the limit in quick succession
for (let i = 0; i < 10; i++) {
    wrapperInvocationCount++;
    throttled();
}

// Expect exactly 3 calls to fn within the window
assert.strictEqual(fnInvocationCount, 3, `Expected 3 fn invocations, got ${fnInvocationCount}`);
assert.strictEqual(wrapperInvocationCount, 10, `Expected 10 wrapper invocations, got ${wrapperInvocationCount}`);

// Phase 2: wait longer than the window so the limit resets, then space calls out
await new Promise((resolve) => setTimeout(resolve, 200));

fnInvocationCount = 0;
wrapperInvocationCount = 0;
for (let i = 0; i < 5; i++) {
    wrapperInvocationCount++;
    throttled();
    // Space calls by 150ms (> windowMs) so each is in a fresh window
    await new Promise((resolve) => setTimeout(resolve, 150));
}

// All 5 should fire after the window resets and calls are spaced out
assert.strictEqual(fnInvocationCount, 5, `Expected 5 fn invocations after reset, got ${fnInvocationCount}`);
assert.strictEqual(wrapperInvocationCount, 5, `Expected 5 wrapper invocations after reset, got ${wrapperInvocationCount}`);

console.log('throttle self-test passed ✅');
