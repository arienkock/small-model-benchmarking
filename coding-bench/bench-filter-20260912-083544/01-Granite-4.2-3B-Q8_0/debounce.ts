export function debounce(fn: (...args: any[]) => void, waitMs: number) {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let lastArgs: any[] = [];
    return (...args: any[]) => {
        if (timer !== null) {
            clearTimeout(timer);
            timer = null;
        }
        lastArgs = args;
        timer = setTimeout(() => {
            fn(...lastArgs);
        }, waitMs);
    };
}

// Self-test when executed directly
if (process.main === module) {
    const calls = [];
    const fn = (...args: any[]) => calls.push(args);
    const debounced = debounce(fn, 100);
    
    // First call - should schedule but not fire
    debounced([1, 2]);
    // Second call before timeout - should cancel previous, reschedule with latest args
    debounced([3, 4]);
    
    // Wait for timeout and verify only the latest call was invoked
    setTimeout(() => {
        if (calls.length === 1 && calls[0] === [3, 4]) {
            console.log("all tests passed");
        } else {
            console.log("test failed");
        }
    }, 200);
}
