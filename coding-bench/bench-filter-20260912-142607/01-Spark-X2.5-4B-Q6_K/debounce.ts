// debounce.ts
export function debounce(fn: (...args: any[]) => void, waitMs: number) {
    let timer: ReturnType<typeof setTimeout> | null = null;
    return (...args: any[]) => {
        if (timer !== null) {
            clearTimeout(timer);
        }
        timer = setTimeout(() => {
            timer = null;
            fn(...args);
        }, waitMs);
    };
}

import assert from 'node:assert';
import { pathToFileURL } from 'node:url';

// Self-test: runs when this file is executed directly (node debounce.ts)
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
    // Test 1: fn is called exactly once waitMs after the LAST call,
    // passing the latest arguments.
    let calls1: any[][] = [];
    let count1 = 0;
    const d1 = debounce(function (...a: any[]) {
        count1++;
        calls1.push(a);
    }, 10);
    d1('a', 1);
    d1('b', 2); // latest call must win
    setTimeout(() => {
        assert.equal(count1, 1, 'expected fn to be called exactly once');
        assert.deepStrictEqual(calls1, [['b', 2]], 'expected fn to receive the latest arguments');

        // Test 2: a new call cancels the pending call and re-debounces,
        // finally calling fn with the latest arguments.
        let calls2: any[][] = [];
        let count2 = 0;
        const fn2 = (...a: any[]) => {
            count2++;
            calls2.push(a);
        };
        const d2 = debounce(fn2, 10);
        d2('x');
        d2('y'); // must cancel the pending 'x' call
        setTimeout(() => {
            assert.equal(count2, 1, 'expected fn to be called once after cancellation');
            assert.deepStrictEqual(calls2, [['y']], 'expected fn called with the latest arguments after cancel');

            console.log('all tests passed');
        }, 30);
    }, 30);
}
