## Plan for Fixing the `debounce` TypeScript Module

### 1. Defect: Pending timeout is not cancelled on new calls

**What is wrong:**  
When the returned debounced function is invoked while a previous `setTimeout` is still pending, the code never calls `clearTimeout` on that pending timer. It only sets `timer` to `null` after scheduling a new timer, but the old timer remains scheduled and will still fire later.

**Concretely what to change:**  
Store the timeout ID in `timer` (do not reset it to `null` immediately after scheduling). When a new call arrives while `timer !== null`, call `clearTimeout(timer)` before scheduling the new timer.

---

### 2. Defect: `timer` is immediately reset to `null` after scheduling

**What is wrong:**  
The line `timer = null;` after `setTimeout(...)` means `timer` is always `null` when the returned function checks `if (timer !== null)`. This completely defeats the purpose of using `timer` as a cancellation token and prevents any detection or cancellation of a pending timeout.

**Concretely what to change:**  
Remove the line `timer = null;` that follows `setTimeout(...)`. Keep `timer` holding the timeout ID so it can be cleared later.

---

### 3. Defect: Stale arguments are passed to `fn` because the previous timeout is not cancelled

**What is wrong:**  
Because the previous timeout is not cancelled when a new call arrives, that old timeout still executes `fn` with the arguments from the previous call, not the latest arguments. This violates the debounce contract of passing only the latest arguments.

**Concretely what to change:**  
Ensure that when a new call is made while a timer is pending, the previous timer is cleared and a new timer is scheduled with the latest arguments. This is achieved by clearing the existing `timer` before scheduling the new one.

---

### 4. Defect: Timeout callback does not clear the timer variable after execution

**What is wrong:**  
The `setTimeout` callback calls `fn(...args)` but never clears the `timer` variable. After the timeout fires, `timer` still holds a reference to the just-fired timeout. If a new call arrives afterwards while `timer` is still non-null, the new call will incorrectly think a pending timer exists and will not schedule a new call.

**Concretely what to change:**  
In the `setTimeout` callback, after invoking `fn`, clear the timer (e.g., call `clearTimeout(timer)` or set `timer = null`) so that the variable accurately reflects that no pending timer remains.

---

### 5. Defect: No reliable way to detect or cancel a pending timeout

**What is wrong:**  
Because `timer` is always `null` after scheduling (due to defect 2), the check `if (timer !== null)` in the returned function can never detect a pending timeout. Therefore, the function cannot cancel or track a pending call, leading to overlapping and stale debounced invocations.

**Concretely what to change:**  
Use a non-null `timer` to hold the pending timeout ID. Use `clearTimeout(timer)` to cancel a pending call when a new call arrives. This gives a reliable mechanism to detect and cancel the previous timeout.

---

### 6. Defect: `setTimeout` callback does not set `timer` to `null` after firing

**What is wrong:**  
After the timeout callback finishes, the `timer` variable is not updated. If a new call occurs immediately after the timeout fires, the new call will see `timer !== null` and return without scheduling, even though the timeout has already completed.

**Concretely what to change:**  
Ensure that after the timeout callback completes, `timer` is set to `null` (or `clearTimeout(timer)` is called and `timer` is reset) so that the next call is properly scheduled.

---

## Required Behaviors for the Self-Test

The self-test must verify the following debounce behaviors:

1. **First call is delayed:** Calling the debounced function with arguments should not invoke `fn` until at least `waitMs` milliseconds have passed.

2. **Multiple calls within the wait window result in a single call with the last arguments:** Calling the debounced function multiple times within `waitMs` should trigger only one call to `fn` after the wait period, and that call should receive the latest arguments.

3. **Call after the previous timeout has completed schedules a new call:** After the previous debounced call has completed, calling the debounced function again should schedule a new call `waitMs` after the new call.

4. **Pending call is cancelled on new call:** If a new call arrives while a previous call is still pending, the previous call must be cancelled and `fn` must not be called with stale arguments.

5. **Latest arguments are passed:** Regardless of how many times the debounced function is called, the final call to `fn` should pass the most recent arguments.

6. **Multiple arguments are preserved:** If the debounced function is called with multiple arguments, `fn` should be called with those same arguments in the same order.

7. **No overlapping calls:** Calling the debounced function rapidly should never cause `fn` to be invoked more than once per `waitMs` interval, even if multiple calls are made before the previous timeout fires.

8. **Edge case: `waitMs = 0` (if tested):** Calling the debounced function should result in `fn` being called immediately (or within the allowed delay) and then subsequent calls should schedule new invocations as appropriate.

The self-test should run when the file is executed directly and print `all tests passed` if all assertions pass.
