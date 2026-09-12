import { pathToFileURL } from "node:url";

/**
 * throttle(fn, maxPerWindow, windowMs)
 *
 * Returns a wrapper that calls `fn` at most `maxPerWindow` times per
 * `windowMs`. Any excess calls are silently skipped.
 *
 * Uses a sliding time window: timestamps older than `windowMs` behind the
 * current time are discarded, so the count resets as time progresses.
 */

let _clock: () => number = () => Date.now();

/**
 * Returns a throttled function that invokes `fn` at most
 * `maxPerWindow` times per `windowMs`.
 *
 * @param fn            The function to invoke.
 * @param maxPerWindow  Maximum number of invocations per window.
 * @param windowMs      Window length in milliseconds.
 * @param clock         Optional callable returning the current time in ms.
 *                       Defaults to `Date.now`. Provided only for testability.
 */
export function throttle(
    fn: () => void,
    maxPerWindow: number,
    windowMs: number,
    clock?: () => number,
): () => void {
    const now = clock ?? _clock;
    let countInWindow = 0;
    const timestamps: number[] = [];

    const wrapper = (...args: unknown[]): void => {
        const t = now();

        // Sliding window: drop timestamps outside the current window.
        while (timestamps.length > 0 && timestamps[0] < t - windowMs) {
            timestamps.shift();
        }

        // Enough calls already happened in this window -> skip.
        if (countInWindow >= maxPerWindow) {
            return;
        }

        timestamps.push(t);
        countInWindow++;
        fn(...args);
    };

    return wrapper;
}

/**
 * Self-test for throttle. Run with: `node throttle.ts`
 */
function runSelfTest(): void {
    let t = 0;
    const clock = (): number => t;
    const advance = (ms: number): void => {
        t += ms;
    };

    // --- Test 1: at most maxPerWindow calls within a single window. ---
    let callCount = 0;
    const throttled = throttle(
        () => {
            callCount++;
        },
        3,
        100,
        clock,
    );

    // Fire many rapid calls; only the first `maxPerWindow` may run.
    for (let i = 0; i < 20; i++) {
        throttled();
    }

    if (callCount > 3) {
        throw new Error(`Expected at most 3 calls, got ${callCount}`);
    }

    // --- Test 2: after the window elapses, calls are allowed again. ---
    // First three calls still count (window has not slid).
    throttled();
    throttled();
    throttled();
    if (callCount !== 3) {
        throw new Error(`Expected call count to be 3, got ${callCount}`);
    }

    // Window has now elapsed past 100ms; the next calls re-enter the window.
    advance(101);
    throttled();
    throttled();
    throttled();
    throttled();
    throttled();

    if (callCount !== 6) {
        throw new Error(`Expected call count to be 6, got ${callCount}`);
    }

    // --- Test 3: a single call within the window does not over-count. ---
    const before = callCount;
    throttled(); // should be skipped because we already have 6.
    if (callCount !== 6) {
        throw new Error(`Expected call count unchanged, got ${callCount}`);
    }

    // Advance past the window again to verify reset works across windows.
    advance(101);
    throttled();
    throttled();
    throttled();
    throttled();
    throttled();
    throttled();

    if (callCount !== 10) {
        throw new Error(`Expected call count to be 10, got ${callCount}`);
    }

    console.log("throttle self-test passed");
}

// Run the self-test when executed directly (e.g. `node throttle.ts`).
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
    runSelfTest();
}
