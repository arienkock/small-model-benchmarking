### DEFECT
WHY: The code sets `timer = null` immediately after scheduling, so the pending timeout is never tracked and cannot be cancelled by subsequent calls; the exact wrong line is `timer = null;` after `timer = setTimeout(...)`
FIX: Store the timeout reference and clear the previous timer before scheduling a new one, so pending calls are properly cancelled
TEST:
```ts
import { debounce } from "./target.ts";
import assert from "node:assert";

async function run() {
    let calls: any[] = [];
    const d = debounce((...args: any[]) => calls.push(args), 10);
    d();
    await new Promise(r => setTimeout(r, 5));
    d();
    await new Promise(r => setTimeout(r, 15));
    assert.deepStrictEqual(calls, [["a"], ["b"]]);
    assert.strictEqual(calls.length, 2);
    console.log("TEST PASSED");
}

run();
```
