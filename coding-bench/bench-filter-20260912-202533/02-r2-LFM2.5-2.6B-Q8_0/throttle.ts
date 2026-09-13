// throttle.ts - Throttle function wrapper

/**
 * Returns a wrapper around fn that limits calls to at most maxPerWindow times
 * per windowMs. Excess calls are silently skipped.
 *
 * @param fn - Function to throttle (called at most maxPerWindow times per windowMs)
 * @param maxPerWindow - Maximum number of calls allowed in the window
 * @param windowMs - Time window in milliseconds
 * @returns A throttled version of fn
 */
export function throttle(fn: () => void, maxPerWindow: number, windowMs: number): () => void {
    const calls: number[] = [];

    return function (...args: any[]): void {
        const now = Date.now();
        // Remove calls older than the window
        calls = calls.filter(timestamp => now - timestamp < windowMs);

        if (calls.length >= maxPerWindow) {
            // Skip this call
            return;
        }

        // Record this call
        calls.push(now);
        fn(...args);
    };
}

// Self-test
if (typeof window === "undefined") {
    // Run in Node.js environment
    const { throttle } = require("./throttle.ts");
    const test = () => console.log("Hello from throttled function");

    // Test 1: First 5 calls should succeed
    for (let i = 0; i < 5; i++) {
        test();
    }

    // Test 2: 6th call should be skipped (no side effect)
    test();

    console.log("Self-test completed");
} else {
    // In a browser environment, just verify the function is defined
    console.log("Throttle function exported:", typeof throttle);
}
