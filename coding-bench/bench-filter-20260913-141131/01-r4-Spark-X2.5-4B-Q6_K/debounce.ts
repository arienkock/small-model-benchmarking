import assert from 'node:assert';
import { pathToFileURL } from 'node:url';

export function debounce(fn: (...args: any[]) => void, waitMs: number) {
    let timer: ReturnType<typeof setTimeout> | null = null;
    return (...args: any[]) => {
        if (timer !== null) {
            clearTimeout(timer);
            timer = null;
        }
        timer = setTimeout(() => {
            timer = null;
            fn(...args);
        }, waitMs);
    };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
    // Self-test: verifies debounce delays until waitMs since the LAST call,
    // cancels pending calls, and passes through the latest arguments.
    const calls: any[][] = [];
    let counter = 0;

    const fn = (...args: any[]) => {
        calls.push(args);
        counter++;
    };

    const debounced = debounce(fn, 10);

    // First call schedules a pending call.
    debounced(1, 2, 3);
    // Second call cancels the pending call and reschedules with latest args.
    debounced('a', 'b');
    // Third call cancels again, keeping the latest args.
    debounced('x', 'y');

    setTimeout(() => {
        // After waitMs, fn is called once with the latest arguments.
        assert.equal(calls.length, 1);
        assert.deepEqual(calls[0], ['x', 'y']);

        // A new call after the pending call completes reschedules again.
        const newVal = 42;
        const newVal2 = 43;
        debounced(newVal, newVal2);
        setTimeout(() => {
            assert.equal(calls.length, 2);
            assert.deepEqual(calls[1], [newVal, newVal2]);

            console.log('all tests passed');
            process.exit(0);
        }, 10);
    }, 10);
}
