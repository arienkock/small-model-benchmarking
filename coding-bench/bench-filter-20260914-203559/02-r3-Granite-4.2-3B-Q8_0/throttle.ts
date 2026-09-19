/**
 * Throttle a function to call at most maxPerWindow times per windowMs.
 * Returns a wrapper that calls fn at most maxPerWindow times per windowMs.
 * Excess calls are silently skipped.
 */
export function throttle(fn: () => void, maxPerWindow: number, windowMs: number): () => void {
    let timestamps: number[] = [];

    return () => {
        const now = Date.now();
        
        // Remove timestamps outside the window
        const windowStart = now - windowMs;
        while (timestamps.length > 0 && timestamps[0] < windowStart) {
            timestamps.shift();
        }
        
        // Count calls in window
        const inWindowCount = timestamps.length;
        
        if (inWindowCount < maxPerWindow) {
            fn();
            timestamps.push(now);
        }
        // else: silently skip
    };
}

// Self-test when run directly
if (import.meta.main) {
    // Run self-test
    console.log('Testing throttle...');
    
    let callCount = 0;
    const testFn = () => {
        callCount++;
    };
    
    const throttled = throttle(testFn, 2, 1000); // Max 2 calls per second
    
    // Make 5 calls quickly
    for (let i = 0; i < 5; i++) {
        throttled();
    }
    
    console.log('Call count after 5 calls:', callCount); // Should be 2
    
    // Wait a bit
    for (let i = 0; i < 5; i++) {
        throttled();
    }
    
    console.log('Call count after 5 more calls:', callCount); // Should still be 2
    
    // Verify it works
    if (callCount === 2) {
        console.log('Self-test passed!');
    } else {
        console.log('Self-test failed!');
        process.exit(1);
    }
}
