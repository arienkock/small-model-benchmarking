export function debounce(fn: (...args: any[]) => void, waitMs: number) {
    let timer: ReturnType<typeof setTimeout> | null = null;
    return (...args: any[]) => {
        if (timer !== null) {
            clearTimeout(timer); // cancel previous pending call
        }
        timer = setTimeout(() => fn(args), waitMs);
    };
}

// --- Self-test ---
import assert from 'node:assert';
import { pathToFileURL } from 'node:url';

async function runTests() {
    // Test 1: Rapid calls → only one invocation after delay
    let calls: number[] = [];
    const debounced = debounce(() => {
        calls.push(Date.now());
    }, 10);

    debounced();
    debounced();
    debounced();

    await new Promise(resolve => setTimeout(resolve, 30));
    assert.strictEqual(calls.length, 1, 'Expected exactly 1 call after debounce delay');

    // Test 2: Latest arguments are passed through
    const result: string[][] = [];
    const latestArg = debounce((a: string, b: number) => {
        result.push([a, b]);
    }, 10);
    latestArg('hello', 42);

    await new Promise(resolve => setTimeout(resolve, 30));
    assert.deepStrictEqual(result, [['hello', 42]], 'Latest args should be passed through');

    // Test 3: Cancellation on new arrival
    let fired = false;
    const cancelTest = debounce(() => { fired = true; }, 10);
    cancelTest();
    cancelTest(); // second call should cancel the first pending timer

    await new Promise(resolve => setTimeout(resolve, 30));
    assert.strictEqual(fired, false, 'Second call should cancel the first pending call');

    console.log('all tests passed');
}

// Self-test: run when file is executed directly
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
    runTests().catch(err => {
        console.error(err);
        process.exit(1);
    });
}
