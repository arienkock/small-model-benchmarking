// throttle.ts — rate limiter wrapper using only Node.js standard library.
//
// throttle(fn, maxPerWindow, windowMs) returns a wrapper that calls fn at most
// maxPerWindow times per windowMs, silently skipping excess calls.
//
// Self-test: run with `node throttle.ts`

export function throttle(fn: () => void, maxPerWindow: number, windowMs: number) {
    let calls = 0;
    let windowStart = 0;
    let currentMs = windowMs;

    return function wrapper(...args: unknown[]) {
        const now = Date.now();

        if (now - windowStart >= currentMs) {
            calls = 0;
            windowStart = now;
        }

        if (calls < maxPerWindow) {
            calls++;
            fn(...args);
        }
        // excess calls are silently skipped
    };
}

// Self-test
const results = [];
const fn = () => results.push(Date.now());
const throttled = throttle(fn, 2, 1000);

// First two calls should execute fn
throttled();
throttled();

// Third call within the same 1s window should be silently skipped
throttled();

// Verify results
const pass = results.length === 2;
console.log(JSON.stringify({ passed: pass, results }));
process.exit(pass ? 0 : 1);
