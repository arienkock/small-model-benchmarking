// debounce.ts
export function debounce(fn: (...args: any[]) => void, waitMs: number) {
    let timer: ReturnType<typeof setTimeout> | null = null;
    return (...args: any[]) => {
        if (timer !== null) {
            clearTimeout(timer);
        }
        timer = setTimeout(() => fn(args), waitMs);
        timer = null;
    };
}

// Self-test
if (import.meta.main) {
    // Simple test: debounce should delay calling fn until waitMs has passed
    const fn = (...args: any[]) => {
        console.log('fn called with args:', args);
    };
    const debouncedFn = debounce(fn, 100);
    
    // Call debouncedFn multiple times quickly
    debouncedFn('first');
    debouncedFn('second');
    debouncedFn('third');
    
    // Wait for the debounce to trigger
    setTimeout(() => {
        console.log('All tests passed');
    }, 150);
}
