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

// Self-test
if (import.meta.main) {
    // Test: call multiple times quickly - only the last call should trigger fn after wait
    let callCount = 0;
    const fn = (arg: any) => {
        callCount++;
    };
    const debounced = debounce(fn, 100);
    
    // Fire calls quickly - they should all be canceled except the last one
    debounced('first');
    debounced('second');
    debounced('third');
    
    // Wait for debounce to trigger - after 100ms, fn should be called once with 'third'
    setTimeout(() => {
        // The debounced function should have been called 3 times, but only fn should be called once
        if (callCount === 1) {
            console.log('all tests passed');
        } else {
            console.error('test failed: expected 1 call, got', callCount);
        }
    }, 150);
}
