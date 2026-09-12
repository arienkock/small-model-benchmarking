// debounce.ts
export function debounce(fn: (...args: any[]) => void, waitMs: number) {
    let timer: ReturnType<typeof setTimeout> | null = null;
    return (...args: any[]) => {
        // Cancel any pending execution and schedule the new call
        console.log('debounced called with', args);
        if (timer !== null) {
            console.log('  cancelling old timer:', timer);
            clearTimeout(timer);
            timer = null;
        }
        timer = setTimeout(() => {
            console.log('  firing timer, calling fn with', args);
            fn(args);
        }, waitMs);
        console.log('  new timer:', timer);
    };
}

// Self-test that runs when the file is executed directly
if (process.argv[1].endsWith('debounce.ts')) {
    let callCount = 0;
    const results: string[] = [];

    function runTest() {
        results.push('start');
        const fn = () => {
            callCount++;
            results.push('called');
        };
        const debounced = debounce(fn, 50);
        debounced(1, 2, 3);
        // Fire again immediately — should cancel the pending timer and schedule a new one
        debounced(4, 5, 6);
    }

    runTest();

    // Wait for both timers to fire
    setTimeout(() => {
        console.log('results:', results);
        console.log('callCount:', callCount);
        if (results.length === 3 && callCount === 1) {
            console.log('all tests passed');
        } else {
            console.log('fail:', results);
        }
    }, 120);
}
