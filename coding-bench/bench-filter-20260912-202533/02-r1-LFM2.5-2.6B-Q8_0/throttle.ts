/**
 * Throttle utility - limits a function to a maximum number of calls
 * within a given time window.
 *
 * @param fn - The function to throttle
 * @param maxPerWindow - Maximum number of calls allowed in the window
 * @param windowMs - Window size in milliseconds
 * @returns A wrapped function that silently skips excess calls
 */
export function throttle(fn: () => void, maxPerWindow: number, windowMs: number): (() => void) => void {
    let calls = 0;
    const windowStart = Date.now();

    return (): void => {
        const now = Date.now();
        if (now - windowStart >= windowMs) {
            // Window has expired - reset the counter
            calls = 0;
            windowStart = now;
        }

        if (calls >= maxPerWindow) {
            // Rate limit exceeded - skip the call
            return;
        }

        calls++;
        fn();
    };
}

// Self-test: verify the throttle function works correctly
if (import.meta.url === `file://${path.basename(__filename)}`) {
    // Simple test: throttle a function that counts calls
    const counter = 0;
    const throttled = throttle(() => {
        counter++;
        console.log(`Throttled call #${counter}`);
    }, 3, 1000); // 3 calls per 1 second

    // First call should succeed
    throttled();
    // Second call should succeed
    throttled();
    // Third call should succeed
    throttled();
    // Fourth call should be silently skipped
    throttled();
    // Fifth call should also be skipped
    throttled();
    // After waiting 1 second, the window resets and the next call should work
    await new Promise(resolve => setTimeout(resolve, 1100));
    throttled();
    console.log("Self-test completed");
}
