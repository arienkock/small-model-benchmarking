export function debounce(fn: (...args: any[]) => void, waitMs: number) {
    let timer: ReturnType<typeof setTimeout> | null = null;
    return (...args: any[]) => {
        if (timer !== null) {
            clearTimeout(timer);
        }
        timer = setTimeout(() => {
            fn.apply(undefined, args);
        }, waitMs);
    };
}

// Self-test when executed directly
if (import.meta.main) {
    // Track the last args that were passed
    let capturedArgs: any[] | null = null;
    
    const testFn = function (a: number, b: number, c: number) {
        capturedArgs = [a, b, c];
    };
    
    const debounced = debounce(testFn, 10); // 10ms debounce for faster test
    
    // First call - schedules
    debounced(1, 2, 3);
    // Second call - should cancel the previous and schedule a new one
    debounced(4, 5, 6);
    
    // Wait for debounce period (10ms) - wait longer to be sure
    setTimeout(() => {
        if (capturedArgs === [4, 5, 6]) {
            console.log('all tests passed');
        } else {
            console.log('test failed');
        }
    }, 20); // Wait 20ms, which is > 10ms
}
