// throttle.ts — Export a throttle function that limits calls to a maximum
// number of times per window, keyed by the function name.

import { EventEmitter } from "node:events";

export function throttle(fn: () => void, maxPerWindow: number, windowMs: number): EventEmitter<{ called: boolean; timestamp: number }> {
  // Map of function name -> [timestamps of recent calls]
  const callTimes = new Map<string, number[]>();

  return new EventEmitter({
    on: (event, ...args) => {
      // Skip if window has elapsed
      const now = Date.now();
      const timestamps = callTimes.get(event.name) || [];

      // Remove timestamps outside the window
      const cutoff = now - windowMs;
      const recent = timestamps.filter((ts) => ts > cutoff);

      if (recent.length >= maxPerWindow) {
        // Throttle: do not call fn, but still emit that we tried
        this.emit("throttled", { name: event.name, timestamp: now });
        return;
      }

      // Record this call
      const last = recent[recent.length - 1];
      if (last === undefined) {
        callTimes.set(event.name, [now]);
      } else {
        callTimes.set(event.name, [...recent, now]);
      }

      // Fire the event to notify that the function was called
      this.emit("call", { name: event.name, timestamp: now });
    },
  });
}

// Self-test: create a throttle wrapper and call it more than maxPerWindow times
const throttled = throttle(() => {
  console.log("Function called");
}, 5, 60);

// Call it 7 times — first 5 should work, 6th+ should be throttled
for (let i = 0; i < 7; i++) {
  throttled();
}
