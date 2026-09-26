import { pathToFileURL } from 'node:url';

/**
 * Debounce a function: delay invocations until `waitMs` have elapsed since
 * the last call, and only the most recent call (with its latest arguments)
 * is invoked when the timer fires.
 */
export function debounce(
  fn: (...args: any[]) => void,
  waitMs: number
): (...args: any[]) => void {
  let timer: ReturnType<typeof setTimeout> | null = null;

  return (...args: any[]) => {
    // If a pending timer already exists, cancel it first so the latest
    // call always wins and no stale invocation can happen.
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
      return;
    }

    // Schedule the actual invocation, remembering the pending timer so it
    // can be cancelled by a subsequent call.
    timer = setTimeout(() => {
      timer = null;
      fn(...args);
    }, waitMs);
  };
}

// Self-test: runs only when this file is executed directly.
const __isDirectRun =
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (__isDirectRun) {
  const calls: string[] = [];

  function makeRecorder() {
    let count = 0;
    return {
      count: () => count,
      push: (...args: any[]) => {
        count++;
        calls.push(Array.from(args).map(String).join(','));
      },
    };
  }

  const assert = (cond: boolean, msg: string) => {
    if (!cond) {
      console.error('FAIL: ' + msg);
      process.exit(1);
    }
  };

  const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

  (async () => {
    // 1. Basic delay: a single call fires after waitMs.
    {
      const recorder = makeRecorder();
      const d = debounce(recorder.push.bind(recorder), 100);
      d('a', 'b');
      await wait(150);
      assert(
        recorder.count() === 1 && calls[0] === 'a,b',
        'basic delay fires once after waitMs'
      );
    }

    // 2. Multiple calls within waitMs: only the latest call fires.
    {
      const recorder = makeRecorder();
      const d = debounce(recorder.push.bind(recorder), 100);
      d('a');
      d('b');
      await wait(150);
      assert(
        recorder.count() === 1 && calls[0] === 'b',
        'multiple calls within waitMs -> latest only'
      );
    }

    // 3. Pending call is cancelled by a subsequent call.
    {
      const recorder = makeRecorder();
      const d = debounce(recorder.push.bind(recorder), 100);
      const pendingTimer = setTimeout(() => {
        d('late');
      }, 10);
      await wait(150);
      clearTimeout(pendingTimer);
      assert(
        recorder.count() === 0,
        'pending call cancelled by subsequent call'
      );
    }

    // 4. Latest arguments are preserved across separate re-armings.
    {
      const recorder = makeRecorder();
      const d = debounce(recorder.push.bind(recorder), 100);
      d('a');
      await wait(150);
      assert(
        recorder.count() === 1 && calls[0] === 'a',
        'first call fires with its arguments'
      );
      d('b');
      await wait(150);
      assert(
        recorder.count() === 2 && calls[1] === 'b',
        'latest arguments preserved after firing'
      );
    }

    // 5. Repeated invocations each fire independently and separately.
    {
      const recorder = makeRecorder();
      const d1 = debounce((...args: any[]) => recorder.push('1,' + Array.from(args).map(String).join(',')), 100);
      const d2 = debounce((...args: any[]) => recorder.push('2,' + Array.from(args).map(String).join(',')), 100);
      d1('x');
      d2('y');
      await wait(250);
      assert(
        recorder.count() === 2 && calls[0] === '1,x' && calls[1] === '2,y',
        'repeated invocations each fire independently'
      );
    }

    // 6. No stale invocation: after a call fires, a later call does not
    //    produce an extra stale invocation.
    {
      const recorder = makeRecorder();
      const d = debounce(recorder.push.bind(recorder), 100);
      d('a');
      await wait(150);
      assert(recorder.count() === 1, 'first call fires exactly once');
      d('b');
      await wait(150);
      assert(
        recorder.count() === 2,
        'second call adds no stale extra invocation'
      );
    }

    // 7. Timer is reset after firing, so an immediate re-call fires
    //    promptly and is not delayed by the cleared old timer.
    {
      const recorder = makeRecorder();
      const d = debounce(recorder.push.bind(recorder), 100);
      d('a');
      await wait(150);
      assert(
        recorder.count() === 1 && calls[0] === 'a',
        'debounced call fires after waitMs'
      );
      d('b');
      await wait(150);
      assert(
        recorder.count() === 2 && calls[1] === 'b',
        'timer reset after fire -> immediate re-call fires promptly'
      );
    }
  })();

  console.log('all tests passed');
}
