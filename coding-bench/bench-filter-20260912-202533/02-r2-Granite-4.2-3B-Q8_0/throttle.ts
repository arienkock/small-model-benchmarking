// throttle.ts
// Export function throttle(fn: () => void, maxPerWindow: number, windowMs: number):
// returns a wrapper that calls fn at most maxPerWindow times per windowMs
// silently skips excess calls.

export function throttle(fn: () => void, maxPerWindow: number, windowMs: number): (...args: any[]) => void {
    let callCount = 0;
    let lastCallTime = 0;

    return (...args: any[]) => {
        const now = Date.now();
        const elapsed = now - lastCallTime;

        // If window has passed, reset the call count
        if (elapsed >= windowMs) {
            callCount = 0;
            lastCallTime = now;
        }

        // If we've reached the max limit, skip
        if (callCount >= maxPerWindow) {
            // Silently skip excess calls
            return;
        }

        // Call the function
        fn(...args);

        // Update counters
        callCount++;
        lastCallTime = now;
    };
}

// Self-test
if (import.meta.url === new URL('throttle.ts', import.meta.url).href) {
    const max = 2;
    const windowMs = 1000; // 1 second
    
    let callCount = 0;
    const throttledFn = throttle(() => {
        callCount++;
        console.log(`Function called, total calls: ${callCount}`);
    }, max, windowMs);

    // Make 5 calls quickly
    for (let i = 0; i < 5; i++) {
        throttledFn();
    }
    console.log(`After 5 calls, callCount=${callCount}`);

    // Make more calls - should be throttled
    for (let i = 0; i < 5; i++) {
        throttledFn();
    }
    console.log(`After additional 5 calls, callCount=${callCount}`);

    // Should have called exactly max=2 times total
    if (callCount === max) {
        console.log('Self-test passed');
        process.exit(0);
    } else {
        console.error('Self-test failed');
        process.exit(1);
    }
}
