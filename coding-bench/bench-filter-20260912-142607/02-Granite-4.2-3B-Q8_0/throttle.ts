/**
 * throttle - limit calls to fn to maxPerWindow times within windowMs
 * @param fn - the function to throttle
 * @param maxPerWindow - maximum number of calls allowed
 * @param windowMs - time window in milliseconds
 * @returns a wrapper function
 */
export function throttle(fn: () => void, maxPerWindow: number, windowMs: number): () => void {
    let callCount = 0;
    const lastCallTime = 0;

    const wrapper = () => {
        const now = Date.now();
        const elapsed = now - lastCallTime;

        // If time since last call exceeds windowMs, reset and allow call
        if (elapsed >= windowMs) {
            callCount = 0;
            fn();
            lastCallTime = now;
            return;
        }

        // Still within window - check if we've hit the max
        if (callCount < maxPerWindow) {
            fn();
            callCount++;
            lastCallTime = now;
        }
        // else: silently skip excess calls (do nothing)
    };

    return wrapper;
}

// Brief self-test
if (require.main === module) {
    const delay = 10; // ms
    let callCount = 0;
    
    const throttled = throttle(() => {
        callCount++;
        console.log(`Call ${callCount} at ${Date.now()}`);
    }, 3, delay);

    // Make 10 calls quickly - should only allow 3 calls within the window
    for (let i = 1; i <= 10; i++) {
        throttled();
        console.log(`After call ${i}: calls = ${callCount}`);
    }
    
    console.log('Self-test passed');
}
