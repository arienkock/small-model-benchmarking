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
if (process.argv[1].endsWith('debounce.ts')) {
    let called = false;
    const fn = () => {
        called = true;
    };
    
    const waitMs = 10;
    const debounced = debounce(fn, waitMs);
    
    // First call schedules timer
    debounced();
    
    // Second call before debounce should cancel the first timer
    debounced();
    
    // Wait for debounce to fire exactly once
    setTimeout(() => {
        if (!called) {
            console.log("Test failed: fn was not called");
            process.exit(1);
        } else {
            console.log("all tests passed");
        }
    }, waitMs);
}
