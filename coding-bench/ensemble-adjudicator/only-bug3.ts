// ONLY bug 3: timer nulled synchronously, so the guard never sees a pending timer.
export function debounce(fn: (...args: any[]) => void, waitMs: number) {
    let timer: ReturnType<typeof setTimeout> | null = null;
    return (...args: any[]) => {
        if (timer !== null) { clearTimeout(timer); }
        timer = setTimeout(() => { fn(...args); }, waitMs);
        timer = null;
    };
}
