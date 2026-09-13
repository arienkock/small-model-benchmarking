/**
 * throttle(fn, maxPerWindow, windowMs)
 *
 * Returns a wrapper that calls fn at most maxPerWindow times per windowMs.
 * Excess calls are silently skipped.
 */
export function throttle(fn: () => void, maxPerWindow: number, windowMs: number): () => void {
    let requests = 0;
    let lastReset = 0;

    return function () {
        const now = Date.now();
        // Reset counters when the window expires
        if (now - lastReset >= windowMs) {
            requests = 0;
            lastReset = now;
        }

        // Silently skip excess calls
        if (requests >= maxPerWindow) {
            return;
        }

        requests++;
        fn();
    };
}

// --- Self-test ---
import assert from "node:assert";

let callCount = 0;
const originalFn = (): void => {
    callCount++;
};

const throttled = throttle(originalFn, 2, 50);

async function runSelfTest() {
    // First two calls should succeed
    throttled();
    throttled();
    assert.strictEqual(callCount, 2);

    // Third call within the same window should be silently skipped
    throttled();
    assert.strictEqual(callCount, 2);

    // Wait for the window to expire, then a new call should succeed
    await new Promise(resolve => setTimeout(resolve, 51));
    throttled();
    assert.strictEqual(callCount, 3);

    console.log("All self-tests passed!");
}

runSelfTest();
