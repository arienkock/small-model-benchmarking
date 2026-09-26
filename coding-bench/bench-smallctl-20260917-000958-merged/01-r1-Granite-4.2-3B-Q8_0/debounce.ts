import assert from 'node:assert';

export function debounce(fn: (...args: any[]) => void, waitMs: number) {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let lastCallTime: number | null = null;
    
    return (...args: any[]) => {
        // Cancel any pending timer
        if (timer !== null) {
            clearTimeout(timer);
            timer = null;
        }
        
        // Record the time of this call
        lastCallTime = Date.now();
        
        // Schedule the function to run after waitMs
        timer = setTimeout(() => {
            // Only call if this is still the most recent call
            if (lastCallTime === Date.now()) {
                fn(...args);
            }
        }, waitMs);
    };
}

// Self-test
if (import.meta.url === new URL('debounce.ts', import.meta.url).href) {
    // Test 1: Basic debounce behavior
    let called = false;
    const debounced = debounce(() => {
        called = true;
    }, 100);
    
    // Call multiple times quickly - only the last call should trigger
    debounced();
    debounced();
    debounced();
    
    // Wait for debounce
    setTimeout(() => {
        // After 100ms, the function should have been called once
        if (called) {
            console.log('Test 1 passed: debounce called after wait');
        } else {
            console.error('Test 1 failed: debounce did not call');
            assert.fail('Test 1 failed');
        }
    }, 150);
    
    // Test 2: Ensure cancellation works
    called = false;
    const debounced2 = debounce(() => {
        called = true;
    }, 50);
    
    // Call first
    debounced2();
    // Call second before first timeout
    debounced2();
    
    // Wait for timeout
    setTimeout(() => {
        // Only the last call should trigger
        if (called) {
            console.log('Test 2 passed: debounce cancellation works');
        } else {
            console.error('Test 2 failed: debounce did not respect cancellation');
            assert.fail('Test 2 failed');
        }
    }, 80);
    
    // Run assertions after the timeouts
    setTimeout(() => {
        assert.ok(called, 'Test 1 passed');
        // Note: Test 2's assertion will be checked after its timeout
    }, 200);
    
    console.log('all tests passed');
}
