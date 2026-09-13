export function debounce(fn: (...args: any[]) => void, waitMs: number) {
    let timer: ReturnType<typeof setTimeout> | null = null;
    return (...args: any[]) => {
        if (timer !== null) {
            clearTimeout(timer);
        }
        timer = setTimeout(() => fn(...args), waitMs);
    };
}

// Self-test: verify debounce behavior
if (import.meta.main) {
    const testFn = function() {
        return 'called';
    };
    const debounced = debounce(testFn, 50); // use shorter wait for easier testing
    
    let calledCount = 0;
    const originalFn = testFn;
    
    // Wrap the test function to count calls
    const wrappedFn = (...args: any[]) => {
        calledCount++;
        return originalFn(...args);
    };
    
    // Replace testFn temporarily
    const debouncedWithWrapper = debounce(wrappedFn, 50);
    
    // Call multiple times quickly - should only call once after the wait period
    debouncedWithWrapper();
    debouncedWithWrapper();
    debouncedWithWrapper();
    
    // Wait for the debounce period (50ms) plus a little buffer
    setTimeout(() => {
        // After 50ms from the last call, all three should have been debounced to a single call
        if (calledCount === 1) {
            console.log("all tests passed");
        } else {
            console.log("test failed: expected 1 call, got", calledCount);
        }
    }, 100);
}
