// debounce.ts
import { assert } from 'node:assert';
import { pathToFileURL } from 'node:url';

export function debounce(fn: (...args: any[]) => void, waitMs: number) {
    let timer: ReturnType<typeof setTimeout> | null = null;
    return (...args: any[]) => {
        if (timer !== null) {
            clearTimeout(timer);
            timer = null;
        }
        timer = setTimeout(() => {
            timer = null;
            fn(args);
        }, waitMs);
    };
}

// Self-test: runs only when this file is executed directly.
function main(): void {
    let calls: any[] = [];

    // Test 1: repeated calls with different args -> fn called once, with the
    // latest arguments, after waitMs have passed.
    const debounced1 = debounce((...args: any[]) => calls.push(args), 30);
    debounced1(1, 'a');
    debounced1(2, 'b');
    debounced1(3, 'c');

    setTimeout(() => {
        assert.deepEqual(calls, [[3, 'c']], 'test1: should call fn once with latest args');

        // Test 2: a new call cancels a pending call so fn is only called once.
        let count = 0;
        const debounced2 = debounce(() => {
            count++;
        }, 50);

        debounced2('first');
        setTimeout(() => {
            debounced2('second'); // arrives before the pending timeout fires (cancels it)
            setTimeout(() => {
                assert.strictEqual(count, 1, 'test2: new call should cancel the pending call');
                console.log('all tests passed');
            }, 100);
        }, 10);
    }, 100);
}

const isMain = pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) {
    main();
}
