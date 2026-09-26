## Plan for Fixing `debounce.ts`

### Defects to Fix

1. **Stale `args` closure in the timer callback**  
   - **Exact issue:** `timer = setTimeout(() => fn(args), waitMs);`  
   - **Problem:** The arrow function `() => fn(args)` captures the `args` variable from the invocation in which the timer was scheduled. Therefore `fn` is called with the arguments of the **last call**, not the **latest arguments**.  
   - **Required change:** Use the current invocation’s arguments when invoking `fn`. For example, replace `() => fn(args)` with `() => fn(...args)`.

2. **Missing `clearTimeout` call**  
   - **Exact issue:** No `clearTimeout(timer)` is ever called in the returned debounced function.  
   - **Problem:** When a new call arrives while a timer is still pending, the previous timer is never cancelled, so it remains scheduled and can fire later.  
   - **Required change:** In the returned function, when `timer !== null`, call `clearTimeout(timer)` before returning. This cancels the pending call.

3. **Immediate `timer = null` after scheduling defeats pending-timer tracking**  
   - **Exact issue:** `timer = null;` is set immediately after scheduling the timer.  
   - **Problem:** This loses the reference to the pending timeout. Since `timer` becomes `null`, the guard `if (timer !== null)` does not detect a pending timer, and the previously scheduled call is never cancelled. Every new call schedules a fresh timer, but the old one still fires with stale arguments.  
   - **Required change:** Do **not** set `timer = null` immediately after scheduling. Keep `timer` pointing to the pending timeout until it fires or is cancelled. The timer callback should clear and reset `timer` before invoking `fn`.

4. **Guard does not cancel pending timer**  
   - **Exact issue:** `if (timer !== null) { return; }`  
   - **Problem:** Although this guard prevents scheduling a new timer while one is pending, it does not cancel the pending timer. The stale timer remains scheduled and will still execute.  
   - **Required change:** When the guard detects a pending timer, call `clearTimeout(timer)` and set `timer = null`, then return. This ensures the pending call is actually cancelled.

---

### Self-Test Assertions

The self-test must verify the intended debounce behavior. It should run only when the file is executed directly and print `all tests passed` only after all assertions pass.

The self-test must assert the following specific behaviors:

1. **Basic delay and invocation:**  
   Calling the debounced function with arguments schedules `fn` to be called exactly once after `waitMs` milliseconds, with those arguments.

2. **Multiple calls within wait period:**  
   If the debounced function is called multiple times within `waitMs`, `fn` is invoked only once, with the arguments of the **last** call.

3. **Cancellation of pending call:**  
   If a new call is made while a debounced call is already pending (before it fires), the pending call is cancelled, `fn` is not called again, and a subsequent call after `waitMs` starts a new debounce window.

4. **Latest arguments are always passed:**  
   `fn` is always called with the arguments from the most recent call, not from any earlier call.

5. **Repeated calls after firing:**  
   If a new call occurs after `fn` has already been called, a new timer is scheduled, and `fn` is called again after `waitMs` with the new arguments.

6. **No stale invocation:**  
   When a new call arrives before the previous timeout fires, `fn` is not called with the previous arguments; it waits for the new call to be debounced.

7. **Timer reset after firing:**  
   After `fn` is called, the pending timer is cleared, so subsequent calls begin a fresh debounce window.

---

### Notes for the Engineer

- The corrected module must keep the same export signature: `export function debounce(fn: (...args: any[]) => void, waitMs: number)`.
- The self-test should be included in the same file but only execute when the file is run directly (e.g., using `if (import.meta.url === ...)` or a simple `if (process.argv[1] === ...)` check).
- The self-test should use real `setTimeout` and `await` to wait for the debounced call to fire, since Node 24 runs `.ts` files natively.
- The self-test must print `all tests passed` only when all assertions pass; otherwise, it should report a failure.
