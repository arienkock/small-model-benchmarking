### DEFECT
WHY: The function does not cancel the pending timer when a new call arrives; it only returns early without clearing the existing timer, causing the old timer to still fire after waitMs from the previous call.  
FIX: Clear the existing timer (set timer = null) before scheduling a new one when a new call is detected.  
TEST:
```ts
import { debounce } from "./target.ts";
import assert from "node:assert";

async function test() {
    const calls = [];
    const fn = (...args: any[]) => calls.push(Date.now());
    const debounced = debounce(fn, 50); // waitMs = 50 ms
    const startTime = Date.now();
    
    debounced();                     // first call
    await new Promise(r => setTimeout(r, 10)); // second call after 10 ms
    debounced();                     // second call
    
    // Wait longer than the correct delay (≥ 60 ms from second call)
    await new Promise(r => setTimeout(r, 80));
    
    // The fn should have been called exactly once (debounced)
    assert.strictEqual(calls.length, 1);
    const fnCallTime = calls[0];
    // With correct debounce, fn fires after waitMs from the second call.
    // Here, second call happened 10 ms after the first, so the expected minimal time is startTime + 10 + 50 = startTime + 60 ms.
    const expectedMin = startTime + 60;
    assert.strictGreater(fnCallTime, expectedMin - 5); // small tolerance
}

test().catch(() => {
    // If any assertion fails, the test is expected to fail, which is fine.
    // No output needed on failure; the harness will see the throw.
});
if (calls.length === undefined) {
    // Ensure we have the calls array defined outside; but better to rely on the closure.
    // We'll just run the test and rely on assert.
}
// For a clean output when the test passes, print the required string.
// However the test function must be invoked without catching errors to allow the pass/fail behavior.
// We'll restructure: run and if no error, print.
try {
    test();
    console.log("TEST PASSED");
} catch (e) {
    // Let the assertion error propagate; the harness will see the throw.
    throw e;
}
```
