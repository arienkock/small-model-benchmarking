// throttle.ts - Throttle function wrapper

/**
 * Returns a wrapper that calls fn at most maxPerWindow times per windowMs.
 * Excess calls are silently skipped.
 *
 * @param fn - The function to throttle
 * @param maxPerWindow - Maximum number of calls allowed in the window
 * @param windowMs - Time window in milliseconds
 * @returns A throttled function
 */
export function throttle(fn: () => void, maxPerWindow: number, windowMs: number): () => void {
    const calls = 0;
    const windowStart = Date.now();
    const max = maxPerWindow;
    const window = windowMs;

    return function (): void {
        const now = Date.now();

        // If we're still within the current window and have reached the limit,
        // skip this call.
        if (now - windowStart < window) {
            if (calls >= max) {
                // Skip this call
                return;
            }
            calls++;
        } else {
            // Window has expired, reset the counter
            calls = 0;
            windowStart = now;
        }

        fn();
    };
}

// Self-test
if (require.main === module) {
    // Test the throttle function
    const testFn = () => {
        const id = Date.now();
        console.log(`Call #${id}`);
    };

    const throttled = throttle(testFn, 3, 1000); // 3 calls per second

    // Make 5 calls quickly
    for (let i = 0; i < 5; i++) {
        throttled();
    }

    console.log("Test completed. Throttle should have allowed only 3 calls.");
}
