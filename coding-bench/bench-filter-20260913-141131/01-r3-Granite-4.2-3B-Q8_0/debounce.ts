// debounce.ts
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
if (process.argv[1] === '/workspace/debounce.ts') {
    let called = false;
    const debounced = debounce(() => {
        called = true;
    }, 100);
    
    // First call
    debounced();
    // Second call before delay
    debounced();
    
    // Wait for debounce to fire
    setTimeout(() => {
        if (!called) {
            console.error('Test 1 failed: basic debounce did not call');
            process.exit(1);
        }
        called = false;
        
        // Test 2: multiple calls, only last should fire after delay
        let callCount = 0;
        const debounced2 = debounce(() => {
            callCount++;
        }, 50);
        
        debounced2();
        debounced2();
        debounced2();
        
        setTimeout(() => {
            if (callCount !== 1) {
                console.error('Test 2 failed: expected 1 call, got', callCount);
                process.exit(1);
            }
            
            console.log('all tests passed');
        }, 60);
    }, 120);
}
