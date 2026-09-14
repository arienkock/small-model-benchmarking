export function debounce(fn: (...args: any[]) => void, waitMs: number) {
    let timer: ReturnType<typeof setTimeout> | null = null;
    return (...args: any[]) => {
        if (timer !== null) {
            clearTimeout(timer); // cancel any pending call before scheduling a new one
            timer = null;
        }
        timer = setTimeout(() => {
            fn(...args); // pass through the latest arguments
            timer = null;
        }, waitMs);
    };
}

// ── Self-test ──────────────────────────────────────────────
import assert from 'node:assert';

const fn: (...args: any[]) => void = (...args) => {
    callCount += 1;
    lastArgs = args;
    console.log('fn called with:', JSON.stringify(args));
};

const debounced = debounce(fn, 10);

let callCount = 0;
let lastArgs: any[] | undefined;

// Rapid calls should result in exactly one execution after the delay,
// passing the latest arguments, and cancelling any pending calls.
debounced('arg1');
debounced('arg2');
debounced('arg3');

setTimeout(() => {
    assert.strictEqual(callCount, 1, 'Expected exactly one call after debounce');
    assert.deepStrictEqual(lastArgs, ['arg3'], 'Expected latest args to be passed');
    console.log('Test passed: debounce works correctly');
    console.log('all tests passed');
}, 50);