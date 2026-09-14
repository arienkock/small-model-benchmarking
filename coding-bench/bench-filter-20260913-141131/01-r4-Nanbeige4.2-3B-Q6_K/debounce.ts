export function debounce(fn: (...args: any[]) => void, waitMs: number) {
    let timer: ReturnType<typeof setTimeout> | null = null;
    return (...args: any[]) => {
        if (timer !== null) {
            clearTimeout(timer);
        }
        timer = setTimeout(() => {
            timer = null;
            fn(args);
        }, waitMs);
    };
}

// ── Self-test ──────────────────────────────────────────────
import assert from 'node:assert';

console.log('Module loaded');

let calls: number[] = [];
const debounced = debounce(() => {
    console.log('debounced callback called with:', args);
    calls.push(Date.now());
}, 50);

console.log('Before calls, calls length:', calls.length);
debounced(1);
debounced(2);
debounced(3);
console.log('After debounced calls, calls length:', calls.length);

setTimeout(() => {
    console.log('After wait, calls length:', calls.length);
    console.log('Timer state:');
    // We can't access the internal timer, but let's check calls
    assert.strictEqual(calls.length, 1, `Expected 1 call, got ${calls.length}`);

    const callsAfterCancel: number[] = [];
    const debounced2 = debounce(() => {
        console.log('debounced2 callback called with:', args);
        callsAfterCancel.push(Date.now());
    }, 50);

    debounced2(10);
    debounced2(20);
    debounced2(30);
    setTimeout(() => {
        console.log('After wait2, callsAfterCancel length:', callsAfterCancel.length);
        assert.strictEqual(callsAfterCancel.length, 1, `Expected 1 call after cancel, got ${callsAfterCancel.length}`);
        assert.strictEqual(callsAfterCancel[0], 30, `Expected last arg 30, got ${callsAfterCancel[0]}`);

        console.log('all tests passed');
    }, 100);
}, 0);
