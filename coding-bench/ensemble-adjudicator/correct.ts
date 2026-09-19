// Reference implementation: the ORACLE for this experiment.
// Fixes all three seeded defects:
//   bug 1  fn(args) -> fn(...args)            (latest args spread through)
//   bug 2  early return -> clearTimeout+reschedule (debounces to the LAST call)
//   bug 3  timer nulled synchronously -> nulled inside the callback
export function debounce(fn: (...args: any[]) => void, waitMs: number) {
    let timer: ReturnType<typeof setTimeout> | null = null;
    return (...args: any[]) => {
        if (timer !== null) {
            clearTimeout(timer);
        }
        timer = setTimeout(() => {
            timer = null;
            fn(...args);
        }, waitMs);
    };
}
