// debounce.ts
export function debounce(fn: (...args: any[]) => void, waitMs: number) {
    let timer: ReturnType<typeof setTimeout> | null = null;
    return (...args: any[]) => {
        if (timer !== null) {
            clearTimeout(timer); // cancel any pending call from the previous invocation
        }
        timer = setTimeout(() => fn(args), waitMs);
        // Keep timer set to the new ID so subsequent calls can cancel it
    };
}

// ---------- Self-test ----------
import assert from 'node:assert';

let invocationCount = 0;
let lastArgs: any;

const debounced = debounce((...args: any[]) => {
    invocationCount++;
    lastArgs = args;
}, 50);

// Rapidly invoke multiple times within the debounce window
debounced('a');
debounced('b');
debounced('c');
debounced('d');

// After the waitMs period, only the last invocation should have executed
setTimeout(() => {
    assert.strictEqual(invocationCount, 1, `Expected 1 invocation, got ${invocationCount}`);
    assert.deepStrictEqual(lastArgs, ['d'], `Expected last args ['d'], got ${JSON.stringify(lastArgs)}`);
    console.log('all tests passed');
}, 100);
