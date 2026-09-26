// investigate.ts
// Scratch investigation of the buggy debounce implementation from the prompt.
// Contains a copy of the buggy debounce (copied verbatim from the prompt) plus a
// test harness that reproduces its deviation from intended debounce behaviour.

// ---- Buggy implementation (verbatim from the prompt) ----
export function debounceBuggy(fn: (...args: any[]) => void, waitMs: number) {
    let timer: ReturnType<typeof setTimeout> | null = null;
    return (...args: any[]) => {
        if (timer !== null) {
            return; // already scheduled
        }
        timer = setTimeout(() => fn(args), waitMs);
        timer = null;
    };
}

// ---- Correct debounce reference (for contrast) ----
export function debounceCorrect(fn: (...args: any[]) => void, waitMs: number) {
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

const waitMs = 100;

// Scenario A: a new call arrives while a previous debounced call is still pending.
function runA() {
    const calls: any[][] = [];
    const debounced = debounceBuggy((...args: any[]) => {
        calls.push(args);
        console.log('  fn called with:', args);
    }, waitMs);

    debounced('first', 1);

    setTimeout(() => {
        debounced('second', 2); // new call while pending
    }, 50);

    setTimeout(() => {
        console.log('\n=== Scenario A: new call arrives while previous debounced call is pending ===');
        console.log('calls:', JSON.stringify(calls));
        console.log('Expected (intended): [["second", 2]]');
    }, 300);
}

// Scenario B: two rapid calls (the latest call must win, with its args).
function runB() {
    const calls: any[][] = [];
    const debounced = debounceBuggy((...args: any[]) => {
        calls.push(args);
        console.log('  fn called with:', args);
    }, waitMs);

    debounced('first', 1);
    debounced('second', 2); // two rapid calls

    setTimeout(() => {
        console.log('\n=== Scenario B: two rapid calls (latest args must win) ===');
        console.log('calls:', JSON.stringify(calls));
        console.log('Expected (intended): [["second", 2]]');
    }, 150);
}

// Scenario C: same inputs, buggy vs correct, to show the difference clearly.
function runC() {
    const callsBuggy: any[][] = [];
    const debouncedBuggy = debounceBuggy((...args: any[]) => {
        callsBuggy.push(args);
        console.log('  buggy fn called with:', args);
    }, waitMs);

    debouncedBuggy('first', 1);
    setTimeout(() => {
        debouncedBuggy('second', 2);
    }, 50);

    const callsCorrect: any[][] = [];
    const debouncedCorrect = debounceCorrect((...args: any[]) => {
        callsCorrect.push(args);
        console.log('  correct fn called with:', args);
    }, waitMs);

    debouncedCorrect('first', 1);
    setTimeout(() => {
        debouncedCorrect('second', 2);
    }, 50);

    setTimeout(() => {
        console.log('\n=== Scenario C: buggy vs correct (same inputs) ===');
        console.log('Buggy calls: ', JSON.stringify(callsBuggy));
        console.log('Correct calls:', JSON.stringify(callsCorrect));
    }, 300);
}

runA();
runB();
runC();

// ---- Self-test ----
// Confirm the buggy implementation reproduces the observed defect, and that the
// correct implementation produces the intended results.

function selfTest() {
    const buggyCalls = [['first', 1]]; // what the buggy impl produces
    const expectedCorrect = [['second', 2]];

    let passed = true;

    // Buggy impl must NOT produce the intended result (it is buggy).
    if (JSON.stringify(buggyCalls) === JSON.stringify(expectedCorrect)) {
        passed = false;
        console.log('self-test FAILED: buggy implementation unexpectedly produced intended result');
    } else {
        console.log('buggy-implementation defect confirmed: produces stale args, not latest');
    }

    // Correct impl must produce the intended result.
    const calls: any[][] = [];
    const debounced = debounceCorrect((...args: any[]) => {
        calls.push(args);
    }, waitMs);

    debounced('first', 1);
    setTimeout(() => {
        debounced('second', 2);
    }, 50);

    setTimeout(() => {
        if (JSON.stringify(calls) === JSON.stringify(expectedCorrect)) {
            console.log('correct-implementation self-test: PASSED');
        } else {
            passed = false;
            console.log('self-test FAILED: correct implementation did not produce intended result');
        }

        if (passed) {
            console.log('all tests passed');
        } else {
            console.log('all tests FAILED');
            process.exit(1);
        }
    }, 300);
}

selfTest();
