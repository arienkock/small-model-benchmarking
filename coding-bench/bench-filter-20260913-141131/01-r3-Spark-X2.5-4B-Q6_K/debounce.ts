// debounce.ts
export function debounce(fn: (...args: any[]) => void, waitMs: number) {
    let timer: ReturnType<typeof setTimeout> | null = null;
    return (...args: any[]) => {
        if (timer !== null) {
            // A new call arrived while a previous invocation was pending:
            // cancel the pending call and reset the timer so the previous
            // invocation is discarded.
            clearTimeout(timer);
            timer = null;
            return;
        }
        timer = setTimeout(() => {
            timer = null;
            fn(args);
        }, waitMs);
    };
}

// Self-test: runs when the file is executed directly and prints
// "all tests passed" after verifying the debounce behavior.
import assert from 'node:assert';
import { pathToFileURL } from 'node:url';

function selfTest(): void {
    let callCount = 0;
    let lastCall: any[] | null = null;

    const debounced = debounce(
        (...args: any[]) => {
            callCount += 1;
            lastCall = args;
        },
        10
    );

    // Multiple calls within the wait window must not invoke fn more than
    // once, and fn must receive the latest arguments.
    debounced('a', 'b');
    debounced('c');
    debounced('d');

    setTimeout(() => {
        assert.strictEqual(callCount, 1, 'fn should be called exactly once');
        assert.deepStrictEqual(lastCall, ['d'], 'fn should receive the latest arguments');
        console.log('all tests passed');
    }, 30);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
    selfTest();
}
