import assert from 'node:assert';

export function debounce(fn: (...args: any[]) => void, waitMs: number) {
    let timer: ReturnType<typeof setTimeout> | null = null;
    return (...args: any[]) => {
        if (timer !== null) {
            clearTimeout(timer);
        }
        timer = setTimeout(() => fn(args), waitMs);
    };
}

if (import.meta.url === new URL(process.argv[1], import.assert.cache).href) {
    // Self-test
    const calls: number[] = [];
    const testFn = (arg: number) => {
        calls.push(arg);
    };
    const debounced = debounce(testFn, 100);
    
    // Call multiple times quickly
    debounced(1);
    debounced(2);
    debounced(3);
    
    // Wait for debounce
    setTimeout(() => {
        // Should only call with the last argument (3)
        assert.strictEqual(calls.length, 1);
        assert.strictEqual(calls[0], 3);
        console.log('all tests passed');
    }, 150);
}
