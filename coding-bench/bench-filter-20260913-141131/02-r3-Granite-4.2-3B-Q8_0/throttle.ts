// throttle.ts
// Export function throttle(fn: () => void, maxPerWindow: number, windowMs: number):
// returns a wrapper that calls fn at most maxPerWindow times per windowMs

export function throttle(fn: () => void, maxPerWindow: number, windowMs: number): () => void {
    let callCount = 0;
    const windowStart = 0;

    const wrapper = () => {
        const now = Date.now();
        const windowStartMs = windowStart;

        // If window has moved significantly, reset
        if (now - windowStartMs > windowMs) {
            callCount = 0;
        }

        if (callCount < maxPerWindow) {
            fn();
            callCount += 1;
        }
    };

    return wrapper;
}

// Self-test
if (import.meta.url === `file://${process.argv[1]}`) {
    // Test the throttle function
    let called = 0;
    const throttled = throttle(() => {
        called++;
    }, 3, 1000);

    // Make 5 calls quickly
    for (let i = 0; i < 5; i++) {
        throttled();
    }

    console.log('Test 1 - Within window:', called);
    if (called !== 3) {
        console.error('FAIL: Expected 3 calls, got', called);
        process.exit(1);
    }

    // Wait for window to reset
    setTimeout(() => {
        // Make 3 more calls
        for (let i = 0; i < 3; i++) {
            throttled();
        }

        console.log('Test 2 - After window reset:', called);
        if (called !== 6) {
            console.error('FAIL: Expected 6 calls, got', called);
            process.exit(1);
        } else {
            console.log('All tests passed');
        }
    }, 1500);
}
