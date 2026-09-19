// ONLY bug 2: early return, never cancels/reschedules. Args spread, timer nulled in callback.
export function debounce(fn: (...args: any[]) => void, waitMs: number) {
    let timer: ReturnType<typeof setTimeout> | null = null;
    return (...args: any[]) => {
        if (timer !== null) { return; }
        timer = setTimeout(() => { timer = null; fn(...args); }, waitMs);
    };
}
