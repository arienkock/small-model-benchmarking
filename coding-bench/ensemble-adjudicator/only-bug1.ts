// ONLY bug 1: args not spread. Timer logic correct.
export function debounce(fn: (...args: any[]) => void, waitMs: number) {
    let timer: ReturnType<typeof setTimeout> | null = null;
    return (...args: any[]) => {
        if (timer !== null) { clearTimeout(timer); }
        timer = setTimeout(() => { timer = null; fn(args); }, waitMs);
    };
}
