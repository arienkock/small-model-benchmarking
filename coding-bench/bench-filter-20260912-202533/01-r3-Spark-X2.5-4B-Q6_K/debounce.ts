// debounce.ts
export function debounce(fn: (...args: any[]) => void, waitMs: number) {
    let timer: ReturnType<typeof setTimeout> | null = null;
    return (...args: any[]) => {
        // Always clear any pending call first, then schedule a fresh one.
        clearTimeout(timer);
        timer = setTimeout(() => {
            fn(...args); // spread args so the latest call is captured
            timer = null;
        }, waitMs);
    };
}

// Self-test (runs when this file is executed directly)
import { pathToFileURL } from 'node:url';
import assert from 'node:assert';

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
    let callCount = 0;
    let lastArgs: any[] | null = null;

    const debounced1 = debounce((...args) => {
        callCount++;
        lastArgs = args;
    }, 50);

    debounced1('a', 1);
    debounced1('b', 2);
    debounced1('c', 3);

    setTimeout(() => {
        assert.strictEqual(callCount, 1, 'Test 1: debounced should be called exactly once');
        assert.deepStrictEqual(lastArgs, ['c', 3], 'Test 1: latest arguments should be captured');

        callCount = 0;
        let lastArgs2: any[] | null = null;

        const debounced2 = debounce((...args) => {
            callCount++;
            lastArgs2 = args;
        }, 100);

        debounced2(); // t=0 -> pending fire at t=100

        setTimeout(() => {
            debounced2('late'); // t=50 -> cancels the t=100 fire, reschedules at t=150

            setTimeout(() => {
                assert.strictEqual(callCount, 1, 'Test 2: only the rescheduled call should fire');
                assert.deepStrictEqual(lastArgs2, ['late'], 'Test 2: latest argument should be used');

                callCount = 0;
                let lastArgs3: any[] | null = null;

                const debounced3 = debounce((...args) => {
                    callCount++;
                    lastArgs3 = args;
                }, 30);

                debounced3('x', 1);
                debounced3('y', 2);

                setTimeout(() => {
                    assert.strictEqual(callCount, 1, 'Test 3: debounced should be called exactly once');
                    assert.deepStrictEqual(lastArgs3, ['y', 2], 'Test 3: latest arguments should be captured');

                    console.log('all tests passed');
                }, 30);
            }, 150);
        }, 50);
    }, 50);
}
