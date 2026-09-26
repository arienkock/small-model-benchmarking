import { debounce } from './debounce.ts';

// Test that the exported function works when imported (not just run directly)
const calls: string[] = [];
const d = debounce((...args: any[]) => {
    calls.push(args.join(','));
}, 30);

d('a', 'b');
d('c', 'd');

setTimeout(() => {
    if (calls.length !== 1 || calls[0] !== 'c,d') {
        console.error('IMPORT TEST FAILED:', calls);
        process.exit(1);
    }
    console.log('import test passed');
    process.exit(0);
}, 100);
