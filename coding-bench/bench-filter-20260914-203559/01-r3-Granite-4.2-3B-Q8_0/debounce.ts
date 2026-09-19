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

// Self-test: when executed directly, verify debounce works correctly
if (import.meta.main) {
    let callCount = 0;
    const fn = () => {
        callCount++;
    };
    
    const debounced = debounce(fn, 10);
    
    // Make multiple calls quickly - only the last call should trigger fn
    debounced();
    debounced();
    debounced();
    
    // Wait for debounce to fire (10ms + small buffer)
    setTimeout(() => {
        if (callCount === 1) {
            console.log("all tests passed");
        } else {
            console.error("test failed");
        }
    }, 15);
}
