function throttle(fn: () => void, maxPerWindow: number, windowMs: number): (...args: any[]) => void {
    const timestamps: number[] = [];
    
    const wrapper = (...args: any[]) => {
        const now = Date.now();
        // Count how many calls are within the window
        const count = timestamps.filter(t => now - t <= windowMs).length;
        if (count < maxPerWindow) {
            fn(...args);
            timestamps.push(now);
        }
        // Otherwise, skip the call silently
    };
    return wrapper;
}

// Self-test
if (require.main === module) {
    console.log('Running self-test...');
    
    let calls = 0;
    const max = 2;
    const window = 1000;
    const wrapper = throttle(() => calls++, max, window);
    
    // First two calls should be allowed
    wrapper();
    wrapper();
    
    // Third call should be skipped
    wrapper();
    
    console.assert(calls === 2, `Expected 2 calls, got ${calls}`);
    console.log('Self-test passed');
}

export { throttle };