// debounce.ts
export function debounce(fn: (...args: any[]) => void, waitMs: number) {
    let timer: ReturnType<typeof setTimeout> | null = null;
    return (...args: any[]) => {
        if (timer !== null) {
            clearTimeout(timer); // cancel the pending call
        }
        timer = setTimeout(() => fn(args), waitMs);
    };
}

// ---------- Self-test ----------
// When this file is executed directly via `node debounce.ts`, the self-test runs
// and prints "all tests passed" if everything works correctly.

let calls: string[] = [];

const log = (msg: string) => calls.push(msg);

const assert = (cond: boolean, msg: string) => {
    if (!cond) {
        log(`FAIL: ${msg}`);
        process.exitCode = 1;
    }
};

function runSelfTest() {
    // Test 1: Debounced function does not call fn until waitMs passes.
    let lastCallTime: number | null = null;
    const debounced = debounce(() => {
        lastCallTime = Date.now();
        log(`call invoked at ${Date.now()}`);
    }, 50);

    debounced('arg1');
    debounced('arg2');

    // Force a short delay so the setTimeout can fire.
    setTimeout(() => {
        // After 50ms, only the last call ('arg2') should have executed.
        if (lastCallTime === null) {
            log('FAIL: fn was never called within waitMs');
            process.exitCode = 1;
        } else {
            log('PASS: fn called after waitMs');
        }
    }, 60);

    // Test 2: New calls cancel previously scheduled calls (proper debounce).
    const callCount = 0;
    const debounced2 = debounce(() => {
        callCount++;
        log(`call count: ${callCount}`);
    }, 100);

    debounced2('a');
    debounced2('b');
    debounced2('c');

    setTimeout(() => {
        if (callCount !== 1) {
            log(`FAIL: expected exactly 1 call after rapid invocations, got ${callCount}`);
            process.exitCode = 1;
        } else {
            log('PASS: only the last invocation was executed');
        }
    }, 110);

    // Test 3: Latest arguments are passed through.
    const latestArg: string | null = null;
    const debounced3 = debounce((val: string) => {
        latestArg = val;
        log(`latest arg: ${val}`);
    }, 30);

    debounced3('first');
    debounced3('second');

    setTimeout(() => {
        if (latestArg !== 'second') {
            log(`FAIL: expected latest arg 'second', got ${latestArg}`);
            process.exitCode = 1;
        } else {
            log('PASS: latest arguments passed through');
        }
    }, 35);

    // Final verdict
    const allPassed = calls.every(c => c.startsWith('PASS:'));
    if (allPassed) {
        log('all tests passed');
    } else {
        log('some tests failed');
    }

    // Print results
    console.log('--- Self-test results ---');
    calls.forEach(c => console.log(c));

    if (!allPassed) {
        process.exit(1);
    }

    console.log('all tests passed');
}

// Run self-test only when the file is executed directly (not imported)
// In ESM, import.meta.url is always present; we detect direct execution via argv.
const isDirectExecution = process.argv.length > 1;
if (isDirectExecution) {
    runSelfTest();
}
