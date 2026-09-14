import { pathToFileURL } from "node:url";

export function throttle(
  fn: () => void,
  maxPerWindow: number,
  windowMs: number,
): () => void {
  let lastCall = 0;
  let count = 0;

  return function throttled(...args: unknown[]): void {
    const now = Date.now();

    // If the window has elapsed, reset the counter.
    if (now - lastCall >= windowMs) {
      count = 0;
      lastCall = now;
    }

    count += 1;

    // Skip excess calls within the window.
    if (count > maxPerWindow) {
      return;
    }

    fn(...args);
  };
}


function runSelfTest(): void {
  let calls = 0;

  const throttled = throttle(
    (...args: unknown[]): void => {
      calls += 1;
    },
    5,
    60_000,
  );

  // Fire more calls than the window allows; only maxPerWindow should run.
  for (let i = 0; i < 10; i += 1) {
    throttled();
  }

  if (calls !== 5) {
    throw new Error(
      `throttle self-test failed: expected ${5} calls to run, got ${calls}`,
    );
  }

  console.log("all tests passed");
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  runSelfTest();
}
