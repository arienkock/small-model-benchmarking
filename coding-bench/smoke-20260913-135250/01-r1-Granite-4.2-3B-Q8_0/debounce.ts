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

// Self-test - simple native implementation
if (import.meta.main) {
    const calls: any[] = [];
    const fn = (...args: any[]) => calls.push(args);
    
    const debounced = debounce(fn, 100);
    
    // Fire multiple calls quickly - should only call once after wait
    debounced('a');
    debounced('b');
    debounced('c');
    
    // Wait for debounce
    setTimeout(() => {
        // Should have been called exactly once with the latest args ['c']
        if (calls.length === 1 && calls[0][0] === 'c') {
            console.log("all tests passed");
        } else {
            console.error("Test failed: calls =", calls);
        }
    }, 150);
}
