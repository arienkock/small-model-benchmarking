WHY: nulling the timeout ID with `timer = null;` after scheduling defeats the delayed call.
FIX: keep the timeout ID (do not assign `null`).
TEST: ```ts
import { debounce } from "./target.ts";
import assert from "node:assert";

async function testNullingTimer()
  const testFunc = () => {
    console.log("Test function called");
  };
  const debounced = debounce(testFunc, 1000);
  debounced([]);
  await new Promise(r => setTimeout(r, 2000));
  assert process.stdout.buffer.includes("Test function called");
}

testNullingTimer();
```
```
