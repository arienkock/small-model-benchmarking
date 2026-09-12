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
        }
        timer = setTimeout(() => fn(args), waitMs);
    };
}

// Self-test when run directly
if (require.main === module) {
    // Test 1: Basic debounce - function should only call once after waitMs
    const callCount = 0;
    const debounced = debounce(() => {
        callCount++;
        console.log('Function called');
    }, 100);

    // Call multiple times quickly
    debounced();
    debounced();
    debounced();

    // Wait for the debounce delay
    setTimeout(() => {
        if (callCount === 1) {
            console.log('all tests passed');
        } else {
            console.error('Expected 1 call, got', callCount);
            process.exit(1);
        }
    }, 150);
}
