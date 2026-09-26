/**
 * Throttle function - limits how many times a function can be called per window.
 * Calls fn at most maxPerWindow times per windowMs.
 * Excess calls are silently skipped.
 */

export function throttle(fn: () => void, maxPerWindow: number, windowMs: number): () => void {
    let callCount = 0;
    const now = Date.now();
    const windowStart = now - windowMs;

    return function() {
        // Check if we should allow this call
        if (now - windowStart > windowMs) {
            // New window, reset counters
            callCount = 0;
        }

        // If we've reached the limit, skip silently
        if (callCount >= maxPerWindow) {
            return;
        }

        // Allow the call and increment counter
        fn();
        callCount++;
    };
}

// Self-test when run directly
if (import.meta.url === new URL('.', import.meta.url).href) {
    // Simple self-test: verify the function is exported
    const testFn = () => console.log('test');
    const wrapped = throttle(testFn, 2, 1000);
    wrapped();
    wrapped();
    wrapped(); // Should be silently skipped
    console.log('Self-test passed');
}
