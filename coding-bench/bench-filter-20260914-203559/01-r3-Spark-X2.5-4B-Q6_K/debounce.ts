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
