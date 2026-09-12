// throttle.ts - Throttle function wrapper

/**
 * Returns a throttled version of the given function.
 * The function will be called at most `maxPerWindow` times within `windowMs`
 * milliseconds. Excess calls are silently skipped.
 *
 * @param fn - The function to throttle
 * @param maxPerWindow - Maximum number of calls allowed per window
 * @param windowMs - Time window in milliseconds
 * @returns A throttled function that wraps `fn`
 */
export function throttle(fn: () => void, maxPerWindow: number, windowMs: number): () => void {
    const calls = 0;
    const windowStart = Date.now();
    const max = maxPerWindow;
    const window = windowMs;

    return function throttledFn(): void {
        const now = Date.now();
        // If enough time has passed since the last call, allow the function to run
        if (now - windowStart >= window) {
            calls = 0;
            windowStart = now;
            fn();
        } else {
            // Skip this call
            return;
        }
    };
}

// Self-test
if (require.main === module) {
    // Test that the throttle function works correctly
    const throttled = throttle(() => {
        console.log("Function called");
    }, 5, 1000); // 5 calls per 1 second

    const calls = 0;
    const originalFn = throttled;

    // Call the throttled function multiple times
    for (let i = 0; i < 10; i++) {
        originalFn();
        calls++;
        if (calls >= 5) {
            console.log(`Call ${calls} - throttled (should be skipped)`);
        }
    }

    console.log(`Total calls made: ${calls}`);
    console.log("Self-test passed:", calls <= 5);
}
