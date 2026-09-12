// debounce.ts
export function debounce(fn: (...args: any[]) => void, waitMs: number) {
    let timer: ReturnType<typeof setTimeout> | null = null;
    return (...args: any[]) => {
        if (timer !== null) {
            clearTimeout(timer);
            timer = null;
        }
        timer = setTimeout(() => fn.apply(undefined, args), waitMs);
    };
}

// Self-test - runs when the file is executed directly
if (import.meta?.main) {
    let fnCallCount = 0;
    
    const fn = () => {
        fnCallCount++;
    };
    
    const debounced = debounce(fn, 100);
    
    // Rapid calls - they should all cancel each other
    debounced();
    debounced();
    
    // Wait for debounce period
    setTimeout(() => {
        // Only the last call should result in a fn invocation
        if (fnCallCount === 1) {
            console.log('all tests passed');
        } else {
            console.error('test failed: expected 1 call, got', fnCallCount);
        }
    }, 200);
}
