/**
 * throttle — rate-limit a function call.
 *
 * @param fn      The function to wrap (must be called at most maxPerWindow times
 *                within every windowMs milliseconds).
 * @param maxPerWindow Maximum number of times fn may be called per window.
 * @param windowMs   Length of the sliding rate-limit window in milliseconds.
 * @returns A wrapper that calls fn at most maxPerWindow times per windowMs;
 *          excess calls are silently skipped.
 */
export function throttle(fn: () => void, maxPerWindow: number, windowMs: number): () => void {
    let callCount = 0;
    let lastReset = 0;

    return function () {
        const now = Date.now();
        const elapsed = now - lastReset;

        // Reset the window when enough time has elapsed
        if (elapsed >= windowMs) {
            callCount = 0;
            lastReset = now;
        }

        // Skip if we've hit the limit for this window
        if (callCount >= maxPerWindow) {
            return;
        }

        callCount += 1;
        fn();
    };
}

// ── Self-test ──────────────────────────────────────────────

const maxPerWindow = 3;
const windowMs = 50; // milliseconds — short window for visible test

let callCount = 0;
const wrapped = throttle(() => {
    callCount += 1;
}, maxPerWindow, windowMs);

// Fire many calls within one window
for (let i = 0; i < 10; i++) {
    wrapped();
}

// After the window passes (use setTimeout to let real time advance),
// calls should resume.
setTimeout(() => {
    for (let i = 0; i < 5; i++) {
        wrapped();
    }
    
    console.log('Total calls made:', callCount);

    const expected = maxPerWindow + maxPerWindow; // 2 windows × 3 calls
    if (callCount === expected) {
        console.log('✅ Self-test PASSED');
    } else {
        console.error(`❌ Self-test FAILED: expected ${expected}, got ${callCount}`);
        process.exit(1);
    }
}, windowMs + 50);
