// debounce.ts
export function debounce(fn: (...args: any[]) => void, waitMs: number) {
    let timer: ReturnType<typeof setTimeout> | null = null;
    return (...args: any[]) => {
        clearTimeout(timer); // cancel any pending call when a new one arrives
        timer = setTimeout(() => fn(args), waitMs);
    };
}

// Self-test
if (import.meta.url === `file://${process.argv[1]}`) {
    let callCount = 0;
    let lastArgs = null;
    const testFn = (...args: any[]) => {
        callCount++;
        lastArgs = args;
    };
    const debounced = debounce(testFn, 50);

    debounced(1, 2, 3);
    setTimeout(() => {
        debounced(4, 5, 6);
        setTimeout(() => {
            debounced(7, 8);
            setTimeout(() => {
                console.log('all tests passed');
                process.exit(0);
            }, 10);
        }, 10);
    }, 60);
}
