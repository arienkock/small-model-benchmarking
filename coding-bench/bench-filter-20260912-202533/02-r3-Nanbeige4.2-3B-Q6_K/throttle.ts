export function throttle(fn: () => void, maxPerWindow: number, windowMs: number): () => void {
    let requests = 0;
    let lastReset = 0;

    return function () {
        const now = Date.now();
        const windowElapsed = now - lastReset;

        // Clean up old request counts if the window has passed
        if (windowElapsed >= windowMs) {
            requests = 0;
            lastReset = now;
        }

        if (requests >= maxPerWindow) {
            return; // silently skip excess calls
        }

        requests++;
        fn.call(this);
    };
}

// --- Self-test ---
import { pathToFileURL } from 'node:url';
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
    // Run as `node throttle.ts` — self-test runs here
    const passed = true;

    let calls = 0;

    const throttled = throttle(() => {
        calls++;
    }, 3, 100); // 3 calls per 100ms window

    // Fire 5 rapid calls — only 3 should execute
    throttled();
    throttled();
    throttled();
    throttled(); // skipped
    throttled(); // skipped

    // Wait past the window and fire again — next call should execute
    await new Promise((resolve) => setTimeout(resolve, 150));
    throttled(); // 4th call after reset — should execute

    if (calls !== 4) {
        console.error(`Self-test FAILED: expected 4 calls, got ${calls}`);
        process.exit(1);
    }

    console.log("Self-test PASSED: throttle correctly limits and resets.");

    // Also verify the 4th call after reset is counted (not skipped)
    // Re-run: 3 calls within window + 1 after reset = 4 total
    let calls2 = 0;
    const throttled2 = throttle(() => { calls2++; }, 2, 50);
    throttled2(); // 1
    throttled2(); // 2
    throttled2(); // skipped
    throttled2(); // skipped
    await new Promise((r) => setTimeout(r, 60));
    throttled2(); // 3 after reset — should execute

    if (calls2 !== 3) {
        console.error(`Self-test FAILED: expected 3 calls after reset, got ${calls2}`);
        process.exit(1);
    }

    console.log("All self-tests PASSED.");
}
