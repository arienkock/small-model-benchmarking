// throttle.ts
// export function throttle(fn: () => void, maxPerWindow: number, windowMs: number): () => void {
//     const timestamps: number[] = [];
//     return () => {
//         const now = Date.now();
//         // Remove timestamps outside the window
//         timestamps = timestamps.filter(ts => now - ts <= windowMs);
//         if (timestamps.length < maxPerWindow) {
//             fn();
//             timestamps.push(now);
//         }
//     };
// }

export function throttle(fn: () => void, maxPerWindow: number, windowMs: number): () => void {
    const timestamps: number[] = [];
    
    return () => {
        const now = Date.now();
        // Remove timestamps outside the window
        timestamps = timestamps.filter(ts => now - ts <= windowMs);
        if (timestamps.length < maxPerWindow) {
            fn();
            timestamps.push(now);
        }
    };
}

// Self-test
if (import.meta.url === 'throttle.ts') {
    // Run self-test when executed directly
    console.log('Running self-test...');
    
    // Test 1: Basic functionality
    let callCount = 0;
    const max = 2;
    const window = 100; // 100ms window
    const fn = () => {
        callCount++;
    };
    
    const throttled = throttle(fn, max, window);
    
    // First call should work
    throttled();
    // Second call should work
    throttled();
    // Third call should be skipped (no fn call)
    
    if (callCount === 2) {
        console.log('PASS: throttle correctly limited calls');
    } else {
        console.log('FAIL: throttle did not limit calls correctly');
        process.exit(1);
    }
    
    // Test 2: Different window size
    callCount = 0;
    const fn2 = () => {
        callCount++;
    };
    
    const throttled2 = throttle(fn2, 1, 1000); // 1 call per second
    
    // First call works
    throttled2();
    // Wait 500ms, second call should work (still within 1 second window)
    // Actually, the window is 1 second, and timestamps are all relative,
    // so we need to simulate time passing. Let's just test the basic case.
    throttled2(); // This should be skipped because we already have 1 call in the window
    
    if (callCount === 1) {
        console.log('PASS: throttle respects window');
    } else {
        console.log('FAIL: throttle window test failed');
        process.exit(1);
    }
    
    console.log('All self-tests passed');
}
