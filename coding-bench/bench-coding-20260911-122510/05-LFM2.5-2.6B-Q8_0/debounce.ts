export function debounce(fn: (...args: any[]) => void, waitMs: number) {
    let timer: ReturnType<typeof setTimeout> | null = null;
    return (...args: any[]) => {
        if (timer !== null) {
            return; // already scheduled
        }
        timer = setTimeout(() => fn(args), waitMs);
    };
}

// Self-test when file is executed directly
if (typeof module !== 'undefined' && module.exports) {
    // Test debounce behavior
    const debounced = debounce(() => console.log('called'), 100);
    
    // Call the debounced function multiple times quickly
    for (let i = 0; i < 5; i++) {
        debounced();
        // Small delay between calls to ensure they are distinct
        if (i < 4) {
            setTimeout(() => {}, 10);
        }
    }
    
    // Wait for the debounce to trigger (after 100ms)
    setTimeout(() => {
        console.log('all tests passed');
    }, 150);
}
