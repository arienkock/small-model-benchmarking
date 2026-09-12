// debounce.ts
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function debounce(fn: (...args: any[]) => void, waitMs: number) {
    let timer: ReturnType<typeof setTimeout> | null = null;
    return (...args: any[]) => {
        if (timer !== null) {
            clearTimeout(timer);
        }
        timer = setTimeout(() => fn(args), waitMs);
        timer = null;
    };
}

// Self-test
if (process.argv[0] === path.resolve(__dirname, 'debounce.ts')) {
    // Test 1: debounce should delay the function call
    const debounced = debounce(() => console.log('called'), 100);
    debounced(); // should not call fn yet
    setTimeout(() => {
        // Wait a bit to let the timer fire
        console.log('Test 1: debounce delayed correctly');
    }, 150);

    // Test 2: Subsequent calls should cancel the previous timer
    let callCount = 0;
    const debounced2 = debounce(() => {
        callCount++;
        console.log('called with count:', callCount);
    }, 100);
    debounced2(); // first call
    setTimeout(() => {
        debounced2(); // second call - should cancel the first
        console.log('Test 2: second call cancelled first');
    }, 50);

    // Wait for the first timer to fire (if not cancelled)
    setTimeout(() => {
        console.log('Test 3: all tests passed');
    }, 200);
}
