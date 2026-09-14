import { debounce } from './debounce.ts';

let invocationCount = 0;
let lastArgs: any;

const debounced = debounce((...args: any[]) => {
    invocationCount++;
    lastArgs = args;
}, 50);

debounced('a');
debounced('b');
debounced('c');
debounced('d');

setTimeout(() => {
    console.log('invocationCount:', invocationCount);
    console.log('Type of lastArgs:', typeof lastArgs);
    console.log('lastArgs:', lastArgs);
    console.log('lastArgs[0]:', lastArgs[0]);
    console.log('lastArgs[0][0]:', lastArgs[0][0]);
}, 100);
