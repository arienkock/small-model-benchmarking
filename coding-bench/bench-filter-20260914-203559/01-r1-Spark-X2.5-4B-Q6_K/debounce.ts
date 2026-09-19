// debounce.ts

export function debounce(fn: (...args: any[]) => void, waitMs: number) {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let lastArgs: any[] = [];
    return (...args: any[]) => {
        lastArgs = args;
        if (timer === null) {
            timer = setTimeout(() => {
                timer = null;
                fn(...lastArgs);
            }, waitMs);
        }
    };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
    import assert from 'node:assert';
    import { pathToFileURL } from 'node:url';

    const waitMs = 30;

    (async () => {
        // Test 1: multiple rapid calls result in a single invocation with latest args
        {
            let calls: any[] = [];
            const debounced = debounce((...args: any[]) => {
                calls.push(args);
            }, waitMs);

            debounced('a');
            debounced('b');
            debounced('c');

            await new Promise((resolve) => setTimeout(resolve, waitMs + 20));
            assert.equal(calls.length, 1, `expected 1 call, got ${calls.length}`);
            assert.deepEqual(calls[0], ['c'], `expected args ['c'], got ${JSON.stringify(calls[0])}`);
        }

        // Test 2: a new call cancels the pending call and uses the latest args
        {
            let calls: any[] = [];
            const debounced = debounce((...args: any[]) => {
                calls.push(args);
            }, waitMs);

            debounced('a');
            await new Promise((resolve) => setTimeout(resolve, 10));
            debounced('b');

            await new Promise((resolve) => setTimeout(resolve, waitMs + 20));
            assert.equal(calls.length, 1, `expected 1 call, got ${calls.length}`);
            assert.deepEqual(calls[0], ['b'], `expected args ['b'], got ${JSON.stringify(calls[0])}`);
        }

        console.log('all tests passed');
        process.exit(0);
    })();
}
