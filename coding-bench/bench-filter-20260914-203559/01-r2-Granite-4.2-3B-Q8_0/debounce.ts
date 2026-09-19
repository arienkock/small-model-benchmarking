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
if (import.meta.main) {
    let callCount = 0;
    let lastArgs: any[] = null;
    
    const mockFn = (...args: any[]) => {
        callCount++;
        lastArgs = args;
    };
    
    const handler = debounce(mockFn, 20);  // Shorter debounce
    
    // Call multiple times quickly
    handler('first');
    handler('second');
    handler('third');
    
    // Wait for debounce to fire (20ms)
    setTimeout(() => {
        if (callCount !== 1 || lastArgs !== ['third']) {
            console.error('Test 1 failed: expected last call only');
            process.exit(1);
        }
        console.log('test1 passed');
        
        // Reset timer manually for cancellation test
        if (timer !== null) clearTimeout(timer);
        timer = null;
        
        // Call again - should cancel previous pending call
        handler('fourth');
        
        // Wait for debounce of new call (20ms)
        setTimeout(() => {
            if (callCount !== 2 || lastArgs !== ['fourth']) {
                console.error('Test 2 failed: expected new call');
                process.exit(1);
            }
            console.log('test2 passed');
            
            if (callCount === 2 && lastArgs === ['fourth']) {
                console.log('all tests passed');
            }
        }, 40);  // 40ms wait for second debounce
    }, 40);  // 40ms wait for first debounce
}
