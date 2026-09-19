# Findings: debounce.ts

## Defect 1 — Line 8: `timer = setTimeout(() => fn(args), waitMs);`

**Exact line:** `        timer = setTimeout(() => fn(args), waitMs);`

Two distinct problems on this line:

1. The arrow function `() => fn(args)` closes over the `args` rest-parameter from the invocation in which the debounced function was last called. Therefore `fn` is invoked with the arguments captured at that last call — i.e. the arguments from the **last** call, not the latest arguments. This violates the intended behavior of "passing through the latest arguments."

2. There is no `clearTimeout(timer)` call anywhere in the module. As a result, when a new call arrives, the previously scheduled timer is never cancelled: it remains pending and keeps firing. This violates "cancelling any pending call when a new one arrives."

## Defect 2 — Lines 5-6: `if (timer !== null) { return; }`

**Exact lines:**
```
        if (timer !== null) {
            return; // already scheduled
        }
```

The early-return guard does **not** cancel the pending timer. When a new invocation arrives while a timer is pending, the function simply returns immediately without scheduling a new timer and without calling `clearTimeout`. Consequently, the previously scheduled call is never cancelled and will still fire (with stale arguments), directly violating the requirement "cancelling any pending call when a new one arrives."

## Defect 3 — Line 9: `timer = null;`

**Exact line:** `        timer = null;`

After scheduling the timer, `timer` is set to `null`. This is part of the flawed design:

- Clearing `timer` to `null` does **not** cancel the pending timer (there is no `clearTimeout` involved).
- Setting `timer` to `null` defeats its role as an indicator of whether a timer is still pending. Combined with the guard on lines 5-6, the stale pending call remains scheduled and fires; the code never actually cancels the previous call, and every invocation schedules a fresh timer, so it does not implement debounce.
