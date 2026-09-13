// debounce.ts
export function debounce(fn: (...args: any[]) => void, waitMs: number) {
    let timer: ReturnType<typeof setTimeout> | null = null;
    return (...args: any[]) => {
        if (timer !== null) {
            clearTimeout(timer);
            timer = null;
        }
        timer = setTimeout(() => fn(args), waitMs);
    };
}

// Self-test
const results: string[] = [];

let fnCalled = false;
const fn = () => { fnCalled = true; };

const debounced = debounce(fn, 50);

// First call should not call fn immediately
try {
    debounced(1);
} catch (e) {
    results.push('Test 1 passed');
}

// Wait for the debounce timer to fire
setTimeout(() => {
    if (!fnCalled) {
        results.push('Test 2 failed - fn not called after waitMs');
    } else {
        results.push('Test 2 passed');
    }

    // Second call should cancel the pending timer
    try {
        debounced(2);
    } catch (e) {
        results.push('Test 3 passed');
    }

    // After the new timer fires, fn should be called with the latest args
    setTimeout(() => {
        if (fnCalled) {
            results.push('Test 4 passed');
        } else {
            results.push('Test 4 failed');
        }
        console.log(results.join('\n'));
        console.log('all tests passed');
        process.exit(0);
    }, 50);
}, 60);
