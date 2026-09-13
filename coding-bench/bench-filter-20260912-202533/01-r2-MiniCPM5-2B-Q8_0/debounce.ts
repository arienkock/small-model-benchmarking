import { pathToFileURL } from 'node:url';

export function debounce(fn: (...args: any[]) => void, waitMs: number) {
    let timer: ReturnType<typeof setTimeout> | null = null;
    return (...args: any[]) => {
        if (timer !== null) {
            clearTimeout(timer);
            timer = null;
        }
        timer = setTimeout(() => fn(...args), waitMs);
    };
}

// Self-test: runs when the file is executed directly.
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
    let callCount = 0;
    let storedArgs: any[] = [];

    const fn = (...args: any[]) => {
        callCount++;
        storedArgs = args;
    };

    const debounced = debounce(fn, 10);
    console.log('Calling debounced function with (1, 2)');
    debounced(1, 2);

    setTimeout(() => {
        if (callCount === 1 && storedArgs.length === 2 && storedArgs[0] === 1 && storedArgs[1] === 2) {
            console.log('all tests passed');
        } else {
            console.log('Test failed: callCount=' + callCount + ', storedArgs=' + JSON.stringify(storedArgs));
        }
    }, 15);
}
