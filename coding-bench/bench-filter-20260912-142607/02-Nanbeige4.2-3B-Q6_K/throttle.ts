export function throttle(fn: () => void, maxPerWindow: number, windowMs: number): () => void {
    let timestamps: number[] = [];

    return function () {
        const now = Date.now();
        // Remove timestamps older than the window
        timestamps = timestamps.filter((ts) => now - ts < windowMs);

        if (timestamps.length >= maxPerWindow) {
            // Silently skip excess calls
            return;
        }

        timestamps.push(now);
        fn();
    };
}

// ── Self-test ──────────────────────────────────────────────
import assert from 'node:assert';
import { setTimeout } from 'node:timers/promises';

let calls = 0;
const fn = () => { calls++; };

const throttled = throttle(fn, 3, 100); // max 3 calls per 100ms

// Fire 5 calls within the window — only first 3 should execute
throttled();
throttled();
throttled();
throttled();
throttled();

assert.strictEqual(calls, 3, `Expected 3 calls, got ${calls}`);

// Fire again after window elapsed — all 5 should execute
throttled();
throttled();
throttled();
throttled();
throttled();

// Simulate a delay by sleeping 200ms before the second batch
await new Promise((resolve) => setTimeout(200, resolve));

throttled();
throttled();
throttled();
throttled();
throttled();

assert.strictEqual(calls, 8, `Expected 8 calls after reset, got ${calls}`);

console.log("throttle.ts self-test passed ✅");
