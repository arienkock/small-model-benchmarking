// debounce.ts — corrected version (debug version)

/**
 * Debounces a function so it only executes after `waitMs` milliseconds have
 * elapsed since the last invocation, passing through the latest arguments and
 * cancelling any pending call when a new one arrives.
 */
export function debounce(fn: (...args: any[]) => void, waitMs: number) {
    let timer: ReturnType<typeof setTimeout> | null = null;
    return (...args: any[]) => {
        console.log(`debounced called with args: ${JSON.stringify(args)}, timer before:`, timer === null ? 'null' : 'active');
        if (timer !== null) {
            clearTimeout(timer);
        }
        timer = setTimeout(() => {
            console.log(`callback executing with args: ${JSON.stringify(args)}`);
            fn(...args);
            timer = null;
        }, waitMs);
    };
}

// ── Self-test ──────────────────────────────────────────────
import assert from 'node:assert';

let calls: any[] = [];

const originalFn = (...args: any[]) => {
    calls.push({ args, timestamp: Date.now() });
};

const debounced = debounce(originalFn, 200); // use 200ms for reliable test timing

// Simulate rapid calls — fn should NOT fire until 200ms after the last call.
debounced('first');
debounced('second');
debounced('third');

// Wait for the debounce window to expire.
setTimeout(() => {
    console.log(`After 200ms, calls count: ${calls.length}`);
    // Only the latest arguments should have been passed.
    assert.deepStrictEqual(calls.length, 1, `Expected exactly 1 call, got ${calls.length}`);
    assert.deepStrictEqual(calls[0].args, ['third'], `Expected latest args ['third'], got ${JSON.stringify(calls[0].args)}`);

    // Now fire again — should produce a second call after the window.
    debounced('fourth');

    // Wait another full window for the second call.
    setTimeout(() => {
        assert.deepStrictEqual(calls.length, 2, `Expected 2 calls after second window, got ${calls.length}`);
        assert.deepStrictEqual(calls[1].args, ['fourth'], `Expected ['fourth'], got ${JSON.stringify(calls[1].args)}`);

        // Verify timestamps: calls should be spaced more than waitMs apart.
        const [first, second] = calls;
        assert(second.timestamp - first.timestamp >= 200, `Timestamps too close: ${second.timestamp - first.timestamp}ms`);

        console.log('all tests passed');
    }, 200);
}, 0);
