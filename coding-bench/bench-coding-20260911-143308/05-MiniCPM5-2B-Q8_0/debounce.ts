// debounce.ts
export function debounce(fn: (...args: any[]) => void, waitMs: number) {
    let timer: ReturnType<typeof setTimeout> | null = null;
    return (...args: any[]) => {
        if (timer !== null) {
            clearTimeout(timer);
            timer = null;
        }
        timer = setTimeout(() => fn(args), waitMs);
    };
}

// self-test
const results: string[] = [];
let callCount = 0;
const originalFn: (...args: any[]) => void = () => { results.push(String(callCount)); callCount++; };
const debounced = debounce(originalFn, 20);

debounced(1);
debounced(2);
setTimeout(() => {
    if (results.length === 1 && results[0] === "0") {
        console.log("all tests passed");
    } else {
        console.log("test failed: results = " + results);
    }
}, 21);
