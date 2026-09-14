import assert from 'node:assert';

export function debounce(fn: (...args: any[]) => void, waitMs: number) {
    let timer: ReturnType<typeof setTimeout> | null = null;
    return (...args: any[]) => {
        // Cancel any pending timer and schedule a fresh one with the
        // current arguments so the latest call always wins.
        clearTimeout(timer);
        timer = setTimeout(() => {
            timer = null;
            fn(...args);
        }, waitMs);
    };
}

async function testDebounce() {
    const calls: any[] = [];
    const debounced = debounce((...args: any[]) => calls.push(args), 100);

    // Multiple calls within the wait window must collapse into a single call
    // with the latest arguments.
    debounced();
    debounced('a', 'b');
    debounced('c');

    await new Promise((resolve) => setTimeout(resolve, 150));

    assert.deepStrictEqual(calls, [['a', 'b', 'c']]);
}

async function testCancellation() {
    const calls: any[] = [];
    const debounced = debounce((...args: any[]) => calls.push(args), 100);

    // A new call before the pending timer fires must cancel it.
    debounced('x');
    debounced('y');

    await new Promise((resolve) => setTimeout(resolve, 150));

    assert.deepStrictEqual(calls, [['y']]);
}

async function main() {
    await testDebounce();
    await testCancellation();
    console.log('all tests passed');
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
