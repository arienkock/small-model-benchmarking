// debounce.ts
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

// Simple self-test using plain Node.js
if (import.meta.main) {
    let callCount = 0;
    const testFn = (...args: any[]) => {
        callCount++;
    };
    
    const debounced = debounce(testFn, 100);
    
    // Call multiple times quickly - should only trigger once after wait
    debounced();
    debounced();
    debounced();
    
    // Wait for debounce period
    setTimeout(() => {
        if (callCount === 1) {
            console.log("all tests passed");
        } else {
            console.error("test failed: expected 1 call, got", callCount);
        }
    }, 150);
}
