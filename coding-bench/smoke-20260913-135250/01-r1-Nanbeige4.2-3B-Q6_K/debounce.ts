// debounce.ts
export function debounce(fn: (...args: any[]) => void, waitMs: number) {
    let timer: ReturnType<typeof setTimeout> | null = null;
    return (...args: any[]) => {
        if (timer !== null) {
            clearTimeout(timer); // cancel the pending call
        }
        timer = setTimeout(() => fn(args), waitMs);
    };
}

// ---------- self-test ----------
import assert from 'node:assert';

let calls: number[] = [];
const debounced = debounce(() => {
    calls.push(Date.now());
}, 10);

// Simulate rapid calls
debounced(1);
debounced(2);
debounced(3);

// Wait for the debounce window
setTimeout(() => {
    // Only the last call should trigger fn after waitMs
    assert.strictEqual(calls.length, 1, `Expected 1 call after debounce, got ${calls.length}`);
    assert.strictEqual(calls[0], calls.length - 1, `Expected only the last call to fire`);

    // Now call again — should schedule a new delayed call
    debounced(4);

    setTimeout(() => {
        assert.strictEqual(calls.length, 2, `Expected 2 calls total, got ${calls.length}`);
        assert.strictEqual(calls[1], calls.length - 1, `Expected second call to fire`);

        console.log("all tests passed");
    }, 15);
}, 15);
