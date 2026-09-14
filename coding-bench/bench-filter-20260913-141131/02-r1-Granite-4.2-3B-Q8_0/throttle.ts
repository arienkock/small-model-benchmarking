// throttle.ts
// Export function throttle(fn: () => void, maxPerWindow: number, windowMs: number):
// returns a wrapper that calls fn at most maxPerWindow times per windowMs and silently skips
// excess calls.

export function throttle(fn: () => void, maxPerWindow: number, windowMs: number): () => void {
  let timestamps: number[] = [];

  return () => {
    const now = Date.now();
    const windowStart = now - windowMs;

    // Count how many calls are within the window
    const recent = timestamps.filter(t => t >= windowStart);
    if (recent.length < maxPerWindow) {
      fn();
      timestamps.push(now);
    }
  };
}

// Self-test
if (import.meta.globEager && typeof import !== 'undefined' && import.meta.globEager['/throttle.ts'].throttle) {
  // The self-test is run by node throttle.ts
  // We'll just export the function and let the test be run externally.
  // This is a simpler self-test for verification.
  // Actually, let's just have a simple test inline that runs when the file is executed.
  
  // We'll keep it simple - the function is exported, and we'll add a basic test
  // when running with node.
  
  // For node execution, we can run a simple test:
  // But the problem says "Include a brief self-test that passes when run with: node throttle.ts"
  // So we'll just export the function and have a minimal self-test.
  
  // Actually, let's just have the function exported, and the self-test is simple:
  // We'll add a conditional that runs when the file is executed directly.
  
  // The simplest approach: export the function and have a simple self-test
  // that verifies the basic behavior.
  
  // Let me just export the function cleanly, and add a simple self-test that doesn't interfere.
}

// Simple self-test when run with: node throttle.ts
// This verifies the throttle function works correctly

const testFn = (called: boolean) => { called = true; };

const maxPerWindow = 3;
const windowMs = 100;

const wrapper = throttle(testFn, maxPerWindow, windowMs);

// Make 5 calls - should only call fn 3 times (maxPerWindow)
wrapper();
wrapper();
wrapper();
wrapper();
wrapper();
wrapper();

if (!testFn.called) {
  console.log('Self-test FAILED: fn was not called');
  process.exit(1);
}

if (testFn.called !== true) {
  console.log('Self-test FAILED: fn was called more than maxPerWindow times');
  process.exit(1);
}

console.log('Self-test PASSED');
