import { debounce } from './debounce';

console.log('Testing current debounce behavior...');

const fn = (a: any, b: any) => console.log(`fn called with (${a}, ${b})`);

// First call
const debounced = debounce(fn, 10);
console.log('Call 1:', debounced(1, 2));

// Second call within waitMs — should cancel pending and use latest args
console.log('Call 2:', debounced(3, 4));

console.log('Done');
