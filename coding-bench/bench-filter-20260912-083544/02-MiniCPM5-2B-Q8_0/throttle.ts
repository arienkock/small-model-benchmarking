// throttle.ts — rate-limited function for Node.js
// Usage: node throttle.ts

// Inline throttle for self-test compatibility
function throttle(fn: () => void, maxPerWindow: number, windowMs: number) {
  const timestamps = new Set<number>();
  const windowMsInt = Math.floor(windowMs);

  console.log('throttle called with maxPerWindow:', maxPerWindow, 'windowMs:', windowMs);

  const wrapped = function () {
    const now = Date.now();
    const idx = timestamps.size;
    console.log('  call, now:', now, 'timestamps.size:', idx);
    if (idx < maxPerWindow) {
      timestamps.add(now);
      fn();
    }
  };
  wrapped.reset = () => timestamps.clear();
  return wrapped;
}

// Self-test
console.log('Testing throttle...');

let passed = 0;
let failed = 0;

function assert(condition, msg) {
  if (condition) {
    console.log(`  ✓ ${msg}`);
    passed++;
  } else {
    console.error(`  ✗ ${msg}`);
    failed++;
  }
}

// Test: maxPerWindow = 2, 5 calls → fn called only twice
let callCount = 0;
const handler = throttle(() => { callCount++; console.log('fn called'); }, 2, 50);
handler(); handler(); handler(); handler(); handler();
console.log('callCount after 5 calls:', callCount);
assert(callCount === 2, 'maxPerWindow = 2, called fn only twice');

console.log(`\nResults: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
