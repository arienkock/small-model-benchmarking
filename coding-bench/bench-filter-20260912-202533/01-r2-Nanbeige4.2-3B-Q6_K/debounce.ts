// debounce.ts
export function debounce(fn: (...args: any[]) => void, waitMs: number) {
    let timer: ReturnType<typeof setTimeout> | null = null;
    return (...args: any[]) => {
        if (timer !== null) {
            clearTimeout(timer); // cancel any pending call from a previous invocation
        }
        timer = setTimeout(() => fn(args), waitMs);
    };
}

// ---------- Self-test (runs only when the file is executed directly) ----------
import assert from 'node:assert';

let calls: string[] = [];

const originalFn = (label: string) => {
    calls.push(label);
};

const debounced = debounce(originalFn, 200);

// First call
debounced('first');
// Second call arrives while first's timer is still pending — should cancel it
debounced('second');

// Wait for debounce timers to settle (200ms + buffer)
setTimeout(() => {
    // After both calls settle, only 'second' should have been called once
    assert.deepStrictEqual(calls, ['second'], 'Expected only the last call to fire');

    // Test that cancelled calls are indeed not invoked
    debounced('third');
    setTimeout(() => {
        assert.deepStrictEqual(calls, ['second', 'third'], 'Expected calls after third invocation');

        // Test with multiple rapid calls — only the very last should fire
        debounced('fourth');
        debounced('fifth');
        setTimeout(() => {
            assert.deepStrictEqual(calls, ['second', 'third', 'fifth'], 'Expected only latest arg among rapid calls');

            console.log('all tests passed');
        }, 50);
    }, 250);
}, 250);
