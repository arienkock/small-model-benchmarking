// debounce.ts
export function debounce(fn: (...args: any[]) => void, waitMs: number) {
    let timer: ReturnType<typeof setTimeout> | null = null;
    return (...args: any[]) => {
        if (timer !== null) {
            clearTimeout(timer);
            timer = null;
        }
        timer = setTimeout(() => fn(...args), waitMs);
    };
}

// Self-test
if (import.meta.main) {
    // Test: create debounce, call it multiple times quickly - should not call fn immediately
    let callCount = 0;
    const testFn = (...args: any[]) => {
        callCount++;
    };
    const debounced = debounce(testFn, 10);
    
    // Call twice quickly - both should be cancelled, only the last one matters after delay
    debounced(1, 2, 3);
    debounced(4, 5, 6);
    
    // After 10ms, the last call should have been made.
    // For a simple self-test, we just verify the function works without crashing.
    // We'll use a very small delay to let the debounce fire.
    setTimeout(() => {
        // The call should have happened after the delay
        if (callCount === 1) {
            console.log('all tests passed');
        } else {
            console.error('test failed');
        }
    }, 15);
}
