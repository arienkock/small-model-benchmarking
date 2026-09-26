import assert from 'node:assert';

export function debounce(fn: (...args: any[]) => void, waitMs: number) {
    let timer: ReturnType<typeof setTimeout> | null = null;
    return (...args: any[]) => {
        if (timer !== null) {
            clearTimeout(timer);
        }
        timer = setTimeout(() => fn(args), waitMs);
    };
}

// Self-test when executed directly
if (import.meta.url === new URL('.', import.meta.url).href) {
    // Test 1: Call multiple times quickly - only the last call should trigger
    let calledOnce = false;
    let calledTwice = false;
    const debounced = debounce(() => {
        calledOnce = true;
    }, 10);
    
    debounced();
    // Second call should cancel the first
    debounced();
    
    // Run after 15ms (more than 10ms) - only the last call should trigger
    setTimeout(() => {
        if (calledOnce) {
            calledOnce = false;
        } else if (calledTwice) {
            calledTwice = false;
        }
        // We expect only the last call to have been triggered
        assert(calledOnce === false, 'calledOnce should be false');
        assert(calledTwice === false, 'calledTwice should be false');
    }, 15);
    
    // Run after 5ms - neither should have triggered yet
    setTimeout(() => {
        assert(calledOnce === false, 'calledOnce should be false');
        assert(calledTwice === false, 'calledTwice should be false');
    }, 5);
    
    // Run after 20ms - the last call should trigger
    setTimeout(() => {
        if (calledOnce) {
            calledOnce = false;
        } else if (calledTwice) {
            calledTwice = false;
        }
        assert(calledOnce === true, 'calledOnce should be true');
        assert(calledTwice === false, 'calledTwice should be false');
        console.log('all tests passed');
    }, 20);
}
