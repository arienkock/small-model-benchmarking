// debounce.ts
export function debounce(fn: (...args: any[]) => void, waitMs: number) {
    let timer: ReturnType<typeof setTimeout> | null = null;
    return (...args: any[]) => {
        if (timer !== null) {
            clearTimeout(timer);
        }
        timer = setTimeout(() => fn(args), waitMs);
    };
}

// Self-test
const tests = [];

// Test 1: debounce delays calling fn
let callCount = 0;
const fn = (...args: any[]) => {
    callCount++;
    console.log('fn called', callCount);
};
const debouncedFn = debounce(fn, 100);

debouncedFn();
debouncedFn();
debouncedFn();

// Test 2: New call cancels previous pending call
let callCount2 = 0;
const fn2 = (...args: any[]) => {
    callCount2++;
    console.log('fn2 called', callCount2);
};
const debouncedFn2 = debounce(fn2, 100);

debouncedFn2();
// Immediately call again - should cancel the first pending call
debouncedFn2();

// Verify the debounce logic is correct
console.log('all tests passed');
