export function debounce(fn: (...args: any[]) => void, waitMs: number) {
    let timer: ReturnType<typeof setTimeout> | null = null;
    return (...args: any[]) => {
        if (timer !== null) {
            clearTimeout(timer); // cancel any pending call before scheduling a new one
        }
        timer = setTimeout(() => {
            fn(args);
            timer = null; // reset timer after execution so next call is allowed
        }, waitMs);
    };
}

// --- Self-test ---
import assert from 'node:assert';

let calls: number[] = [];

const originalFn = (...args: any[]) => {
    calls.push(args);
};

const debounced = debounce(originalFn, 100);

// Simulate rapid calls within the wait window
debounced(1, 'a');
debounced(2, 'b');
debounced(3, 'c');

// Wait for the debounced call to fire (100ms)
setTimeout(() => {
    // Only one call should have been made, with the latest arguments
    assert.strictEqual(calls.length, 1, `Expected 1 call, got ${calls.length}`);
    assert.deepStrictEqual(calls[0], [3, 'c'], `Expected latest args [3, 'c'], got ${JSON.stringify(calls[0])}`);

    // Now trigger another call after the wait window
    debounced(4, 'd');
    setTimeout(() => {
        assert.strictEqual(calls.length, 2, `Expected 2 calls total, got ${calls.length}`);
        assert.deepStrictEqual(calls[1], [4, 'd'], `Expected second call args [4, 'd'], got ${JSON.stringify(calls[1])}`);

        console.log('all tests passed');
    }, 100);
}, 0);
