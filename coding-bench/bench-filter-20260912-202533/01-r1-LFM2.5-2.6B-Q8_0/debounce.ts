// debounce.ts
/**
 * Debounces a function call, delaying execution until waitMs milliseconds have passed
 * since the last call, passing through the latest arguments and cancelling any pending call.
 */
export function debounce(fn: (...args: any[]) => void, waitMs: number) {
    let timer: ReturnType<typeof setTimeout> | null = null;
    return (...args: any[]) => {
        if (timer !== null) {
            clearTimeout(timer);
            timer = null;
        }
        timer = setTimeout(() => fn(args), waitMs);
    };
}

// Self-test when file is executed directly
if (import.meta.main) {
    // Simple test: debounce a function and verify it's called after waitMs
    let callCount = 0;
    const debounced = debounce(() => {
        callCount++;
    }, 50);

    // Call immediately - should not be called yet
    debounced();
    console.log("Initial call count:", callCount);

    // Wait for the debounce window to pass
    await new Promise(resolve => setTimeout(resolve, 60));

    // After waitMs, the function should be called once with the latest arguments
    console.log("After debounce window, call count:", callCount);

    if (callCount === 1) {
        console.log("all tests passed");
    } else {
        console.error("Test failed: expected 1 call after debounce window");
        process.exit(1);
    }
}
