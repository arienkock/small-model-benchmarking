// throttle.ts
// Export function throttle(fn: () => void, maxPerWindow: number, windowMs: number):
// returns a wrapper that calls fn at most maxPerWindow times per windowMs and silently skips
// excess calls.

export function throttle(fn: () => void, maxPerWindow: number, windowMs: number): () => void {
    let calls = 0;
    const windowStart = 0;
    
    // Actually, we need to track timestamps or count calls in window.
    // Let's use a simpler approach: track timestamps.
    
    const timestamps = [];
    
    return () => {
        const now = Date.now();
        // Remove timestamps outside the window
        const windowStartMs = now - windowMs;
        timestamps = timestamps.filter(t => t >= windowStartMs);
        if (timestamps.length >= maxPerWindow) {
            // Skip this call silently
            return;
        }
        timestamps.push(now);
        fn();
    };
}

// Self-test
if (require.main === module) {
    // For Node.js, we need to handle module.main
    // Since we're using ES modules, we'll just test without require
    const maxPerWindow = 5;
    const windowMs = 1000; // 1 second
    let callCount = 0;
    const fn = () => {
        callCount++;
    };
    
    const wrapper = throttle(fn, maxPerWindow, windowMs);
    
    // Make maxPerWindow + 1 calls quickly
    for (let i = 0; i < maxPerWindow + 1; i++) {
        wrapper();
    }
    
    // Should have called fn exactly maxPerWindow times
    if (callCount === maxPerWindow) {
        console.log('PASS: throttle correctly limited calls');
    } else {
        console.log(`FAIL: expected ${maxPerWindow} calls, got ${callCount}`);
        process.exit(1);
    }
}
