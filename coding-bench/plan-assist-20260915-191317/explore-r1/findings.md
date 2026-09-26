# Findings — `debounce.ts`

Source module provided inline: `debounce.ts`

The module is:

```typescript
export function debounce(fn: (...args: any[]) => void, waitMs: number) {
    let timer: ReturnType<typeof setTimeout> | null = null;
    return (...args: any[]) => {
        if (timer !== null) {
            return; // already scheduled
        }
        timer = setTimeout(() => fn(args), waitMs);
        timer = null;
    };
}
```

## Defect 1

- **Exact line:** line 9 — `timer = null;`
- **What is wrong:** Immediately after scheduling the pending timeout with `setTimeout`, the `timer` variable is reset to `null`.
- **Why it breaks debouncing:** The guard `if (timer !== null) { return; }` exists so that a call arriving while a timeout is still pending does not schedule a new timeout. Because `timer` is reset to `null` the instant a timeout is scheduled, the very next invocation (even within `waitMs`) sees `timer === null`, skips the guard, and schedules a brand-new timeout. As a result `fn` is invoked once per call instead of once per `waitMs`, and multiple calls within `waitMs` all fire `fn`.
- **Expected behavior:** `timer` should retain its timeout id until the timeout fires, so a new call during the pending window is ignored and the debounce window is enforced.
- **Actual behavior:** `fn` is called repeatedly; the debounce window is not enforced.

## Defect 2

- **Exact line:** line 8 — `timer = setTimeout(() => fn(args), waitMs);`
- **What is wrong:** `fn` is invoked as `fn(args)` — the arguments array is passed as a single argument rather than spread.
- **Why it breaks:** `fn` is declared `(...args: any[]) => void`, i.e. it expects the call arguments to be spread (`fn(...args)`). Passing the array `args` as one argument means `fn` receives `args` as its first parameter and `undefined` for the rest. The arguments are therefore never forwarded to `fn` correctly.
- **Expected behavior:** `fn` should be called with each argument spread: `fn(...args)`.
- **Actual behavior:** `fn` receives the whole arguments array as a single argument (and no additional arguments), so the values passed to `fn` are wrong.

## Defect 3

- **Exact line:** line 8 — `timer = setTimeout(() => fn(args), waitMs);`
- **What is wrong:** `fn` is invoked without a `this` binding.
- **Why it breaks:** `fn` is invoked inside an arrow function, which inherits `this` from the enclosing `debounce` call. When `debounce` is invoked as a plain function (e.g. `const d = debounce(fn, 100); d(1)`), `this` is `undefined` in strict mode. Any `fn` that relies on `this` (method-style usage) therefore loses its `this` context.
- **Expected behavior:** `fn` should retain the correct `this` context (e.g. via `fn.apply(this, args)` or a bound/regular function).
- **Actual behavior:** `this` is `undefined` when `fn` executes, breaking any `this`-dependent logic.
