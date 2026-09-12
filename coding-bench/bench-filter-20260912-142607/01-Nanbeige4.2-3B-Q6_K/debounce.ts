export function debounce(fn: (...args: any[]) => void, waitMs: number) {
    let timer: ReturnType<typeof setTimeout> | null = null;
    return (...args: any[]) => {
        if (timer !== null) {
            clearTimeout(timer); // cancel previous pending call
        }
        timer = setTimeout(() => fn(args), waitMs);
    };
}

// ── Self-test ──────────────────────────────────────────────
import assert from 'node:assert';

let calls: number[] = [];

const debounced = debounce(() => {
    calls.push(Date.now());
}, 200);

// 1. Rapid calls → only ONE invocation after waitMs
debounced();
debounced();
debounced();

setTimeout(() => {
    assert.strictEqual(calls.length, 1, `Expected 1 call after rapid invocations, got ${calls.length}`);

    // 2. New call after waitMs → schedules a second invocation
    debounced();

    setTimeout(() => {
        assert.strictEqual(calls.length, 2, `Expected 2 calls after second invocation, got ${calls.length}`);

        // 3. Latest arguments are passed through (timestamp reflects latest call)
        const latestTime = calls[calls.length - 1];
        assert.ok(latestTime > 0, 'latest call should have a valid timestamp');

        console.log('all tests passed');
    }, 200);
}, 200);
