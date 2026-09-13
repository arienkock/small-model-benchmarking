// debounce.ts
export function debounce(fn: (...args: any[]) => void, waitMs: number) {
    let timer: ReturnType<typeof setTimeout> | null = null;
    return (...args: any[]) => {
        if (timer !== null) {
            // A call arrived while the previous one is still pending.
            // Cancel the pending call and schedule a fresh one with the
            // latest arguments.
            clearTimeout(timer);
            timer = null;
            return;
        }
        timer = setTimeout(() => {
            fn(args);
            timer = null;
        }, waitMs);
    };
}

// Small self-test that runs when the file is executed directly.
function assert(cond: boolean, msg: string) {
    if (!cond) {
        console.error('TEST FAILED: ' + msg);
        process.exit(1);
    }
}

const calls: number[][] = [];
const fn = (...args: number[]) => calls.push(args);

const d = debounce(fn, 20);

// First call schedules a pending call.
d(1, 2);

// Second call arrives while pending -> ignored, no new call made.
d(3);

setTimeout(() => {
    // After the first debounced call completes, a new call fires normally.
    d(4);
    setTimeout(() => {
        assert(calls.length === 2, 'fn should be called exactly twice');
        assert(JSON.stringify(calls[0]) === JSON.stringify([1, 2]),
            'first call should receive the latest args');
        assert(JSON.stringify(calls[1]) === JSON.stringify([4]),
            'second call should receive the latest args');
        console.log('all tests passed');
    }, 40);
}, 40);
