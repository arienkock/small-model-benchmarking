import assert from 'node:assert';
import { pathToFileURL } from 'node:url';

export function debounce(fn: (...args: any[]) => void, waitMs: number) {
    let timer: ReturnType<typeof setTimeout> | null = null;
    return (...args: any[]) => {
        // If a call is already pending, cancel it first so the previously
        // scheduled invocation is not fired again.
        if (timer !== null) {
            clearTimeout(timer);
        }
        // Schedule a new invocation with the latest arguments.
        timer = setTimeout(() => {
            // Reset the timer before invoking fn so a subsequent call can
            // schedule its own invocation.
            timer = null;
            fn(args);
        }, waitMs);
    };
}

async function runSelfTest() {
    // Test 1: debounce delays the call and passes through the latest arguments
    let calls: any[] = [];
    const debounced = debounce((...args: any[]) => {
        calls.push(args);
    }, 30);

    debounced(1, 2);
    debounced(3);
    assert.equal(calls.length, 0, 'fn should not be called synchronously');
    await new Promise((resolve) => setTimeout(resolve, 10));
    await new Promise((resolve) => setTimeout(resolve, 40));
    assert.deepEqual(calls, [['3']], 'latest arguments should be passed through');

    // Test 2: a new call cancels any pending call
    let calls2: any[] = [];
    const debounced2 = debounce((...args: any[]) => {
        calls2.push(args);
    }, 100);

    debounced2('a', 'b');
    await new Promise((resolve) => setTimeout(resolve, 50));
    debounced2('c', 'd');
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.deepEqual(calls2, [['c', 'd']], 'pending call should be cancelled');

    // Test 3: multiple rapid calls pass only the latest arguments
    let calls3: any[] = [];
    const debounced3 = debounce((...args: any[]) => {
        calls3.push(args);
    }, 20);

    debounced3(1, 2);
    debounced3(3, 4);
    debounced3(5);
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.deepEqual(calls3, [[5]], 'only the latest arguments should be used');

    console.log('all tests passed');
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
    await runSelfTest();
}
