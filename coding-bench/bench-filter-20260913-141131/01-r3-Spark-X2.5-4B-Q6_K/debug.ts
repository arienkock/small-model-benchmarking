export function debounce(fn: (...args: any[]) => void, waitMs: number) {
    let timer: ReturnType<typeof setTimeout> | null = null;
    return (...args: any[]) => {
        console.log('WRAPPER called with args:', JSON.stringify(args), 'timer before:', timer);
        if (timer !== null) {
            console.log('  timer not null, clearing');
            clearTimeout(timer);
            timer = null;
            return;
        }
        timer = setTimeout(() => {
            console.log('TIMER FIRED, args:', JSON.stringify(args));
            timer = null;
            fn(args);
            console.log('  calling fn(args) with', JSON.stringify(args));
        }, waitMs);
    };
}

const debounced = debounce(
    (...args: any[]) => {
        console.log('INNER fn called with args:', JSON.stringify(args));
    },
    10
);

debounced('a', 'b');
debounced('c');
debounced('d');
