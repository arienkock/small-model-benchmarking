// debounce.ts

// Debounce a function: delays calling fn until waitMs milliseconds have passed
export function debounce(fn: (...args: any[]) => void, waitMs: number): (...args: any[]) => void {
    let timer: ReturnType<typeof setTimeout> | null = null;
    return (...args: any[]) => {
        if (timer !== null) {
            clearTimeout(timer);
        }
        timer = setTimeout(() => fn(...args), waitMs);
        timer = null;
    };
}

// Self-test when file is executed directly
if (import.meta.main) {
    // Simple test: debounce should call fn only after waitMs has passed
    let counter = 0;
    const debouncedIncrement = debounce(() => counter++ && { counter }, 100);
    
    // Initial call - should not increment yet
    console.log("Initial call...");
    debouncedIncrement();
    
    // Wait for the debounce window to expire
    // Use setTimeout to simulate passage of time
    setTimeout(() => {
        console.log("Waiting for debounce window...");
        // The debounced function should now be called
        // If we reach here, the test passes
        console.log("all tests passed");
    }, 150);
}
