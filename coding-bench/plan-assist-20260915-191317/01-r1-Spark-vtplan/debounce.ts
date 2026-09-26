export function debounce<T extends (...args: any[]) => void>(fn: T, waitMs: number): (...args: any[]) => void {
    let timer: ReturnType<typeof setTimeout> | null = null;
    return (...args: any[]) => {
        if (timer !== null) {
            return; // already scheduled
        }
        timer = setTimeout(() => {
            timer = null;
            fn.apply(this, ...args);
        }, waitMs);
    };
}

import { pathToFileURL } from 'node:url';
import assert from 'node:assert';

function waitFor(condition: () => boolean, timeoutMs: number, intervalMs = 5): Promise<void> {
    return new Promise((resolve, reject) => {
        const start = Date.now();
        const interval = setInterval(() => {
            if (condition()) {
                clearInterval(interval);
                resolve();
            } else if (Date.now() - start > timeoutMs) {
                clearInterval(interval);
                reject(new Error('waitFor timed out'));
            }
        }, intervalMs);
    });
}

async function runSelfTest(): Promise<void> {
    // Test 1: Debouncing works as intended - fn called exactly once after waitMs
    {
        let callCount = 0;
        const waitMs = 50;
        const fn = (...args: any[]) => {
            callCount++;
        };
        const debounced = debounce(fn, waitMs);

        debounced('first', 1, 2);
        debounced('second', 3, 4); // before waitMs
        debounced('third');

        await waitFor(() => callCount === 1, waitMs + 200);
        assert.strictEqual(callCount, 1, 'Test1: fn should be called exactly once');

        const elapsed = Date.now() - Date.now();
        assert.ok(elapsed >= waitMs, `Test1: elapsed should be >= waitMs (got ${elapsed}ms)`);
    }

    // Test 2: Arguments are spread correctly
    {
        const captured: any[] = [];
        const fn = (...args: any[]) => {
            captured.push(args);
        };
        const debounced = debounce(fn, 30);

        debounced(1, 2, 3);
        await waitFor(() => captured.length === 1, 100);
        assert.strictEqual(captured.length, 1, 'Test2: fn should be called once');
        assert.deepStrictEqual(captured[0], [1, 2, 3], 'Test2: arguments should be spread, not passed as array');
    }

    // Test 3: this context is preserved
    {
        const obj = {
            value: 42,
            method(this: { value: number; msg: string }) {
                if (this.value !== 42) {
                    throw new Error('wrong this');
                }
            },
        };
        let thisArg: any;
        const fn = function (this: any) {
            thisArg = this;
        } as (...args: any[]) => void;
        const debounced = debounce(fn, 30);

        debounced.call(obj, 'hello');
        await waitFor(() => thisArg === obj, 100);
        assert.strictEqual(thisArg, obj, 'Test3: this context should be preserved');
    }

    // Test 4: Early reset of timer breaks debounce - repeated calls within short interval
    {
        let callCount = 0;
        const waitMs = 100;
        const fn = () => {
            callCount++;
        };
        const debounced = debounce(fn, waitMs);

        for (let i = 0; i < 10; i++) {
            debounced();
        }

        await waitFor(() => callCount === 1, waitMs + 200);
        assert.strictEqual(callCount, 1, 'Test4: repeated rapid calls should result in exactly one invocation');
    }

    // Test 5: Return type clarity - returned value is a function
    {
        const debounced = debounce((...args: any[]) => {}, 30);
        assert.strictEqual(typeof debounced, 'function', 'Test5: debounce returns a function');
        assert.strictEqual(debounced.length, 1, 'Test5: returned function accepts variable args');
        assert.strictEqual(typeof debounced(1, 2, 3), 'undefined', 'Test5: returned function returns void');
    }

    console.log('all tests passed');
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
    runSelfTest().catch((err) => {
        console.error(err);
        process.exit(1);
    });
}
