export function debounce(fn: (...args: any[]) => void, waitMs: number) {
    let timer: ReturnType<typeof setTimeout> | null = null;
    return (...args: any[]) => {
        if (timer !== null) {
            clearTimeout(timer);
        }
        timer = setTimeout(() => {
            fn(args);
        }, waitMs);
    };
}

// Self-test when executed directly
if (import.meta.main) {
    let callCount = 0;
    const fn = (...args: any[]) => {
        callCount++;
    };
    const debounced = debounce(fn, 50);
    
    // First batch: make 3 calls quickly - only the last one should trigger after wait
    debounced();
    debounced();
    debounced();
    
    // Wait for debounce period
    setTimeout(() => {
        if (callCount !== 1) {
            console.error('Test 1 failed: expected 1 call, got', callCount);
        } else {
            console.log('Test 1 passed: debounce delayed execution');
            
            // Second batch: make one call (cancels previous pending call)
            debounced();
            
            // Wait for debounce period
            setTimeout(() => {
                if (callCount !== 2) {
                    console.error('Test 2 failed: expected 2 calls, got', callCount);
                } else {
                    console.log('all tests passed');
                }
            }, 50);
        }
    }, 50);
}
