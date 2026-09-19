import assert from 'node:assert';
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
            fn(...args);
        }, waitMs);
    };
}

function runSelfTest() {
    // Test 1: latest arguments are passed and fn is invoked exactly once after waitMs
    let calls: any[] = [];
    const debounced = debounce((...args: any[]) => {
        calls.push(args);
    }, 10);

    debounced(1, 2);
    debounced(3);

    setTimeout(() => {
        assert.deepStrictEqual(calls, [[3]]);

        // Test 2: a new call cancels the pending invocation
        let count = 0;
        const debounced2 = debounce(() => {
            count++;
        }, 10);

        debounced2();
        debounced2();

        setTimeout(() => {
            assert.strictEqual(count, 1);
            console.log('all tests passed');
        }, 30);
    }, 30);
}

// Run the self-test only when this file is executed directly
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
    runSelfTest();
}
