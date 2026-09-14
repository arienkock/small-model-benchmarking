export function debounce(fn: (...args: any[]) => void, waitMs: number) {
    let timer: ReturnType<typeof setTimeout> | null = null;
    
    return (...args: any[]) => {
        if (timer !== null) {
            clearTimeout(timer);
        }
        timer = setTimeout(() => {
            fn(...args);
        }, waitMs);
    };
}

// Self-test when executed directly
if (import.meta.main || process.argv[1] === __filename) {
    // Simple self-test: verify debounce works correctly
    let fnCallCount = 0;
    let lastArgs: any[] = [];
    
    const testFn = (...args: any[]) => {
        fnCallCount++;
        lastArgs = args;
    };
    
    const debounced = debounce(testFn, 100);
    
    // Multiple rapid calls
    debounced();
    debounced();
    debounced();
    
    // Wait for debounce period and verify only the last call triggered
    setTimeout(() => {
        if (fnCallCount === 1) {
            console.log('all tests passed');
        } else {
            console.error('test failed: expected 1 call, got', fnCallCount);
        }
    }, 150);
}
