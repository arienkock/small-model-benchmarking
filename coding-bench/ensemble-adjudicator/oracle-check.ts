import assert from 'node:assert';
import { debounce } from './correct.ts';
async function main() {
  // clause: fires once, after the LAST call, with the LATEST args
  const seen: any[][] = [];
  const d = debounce((...a: any[]) => seen.push(a), 60);
  d(1, 'a'); d(2, 'b'); d(3, 'c');
  await new Promise(r => setTimeout(r, 200));
  assert.strictEqual(seen.length, 1, `expected exactly 1 call, got ${seen.length}`);
  assert.deepStrictEqual(seen[0], [3, 'c'], `expected latest args spread, got ${JSON.stringify(seen[0])}`);
  console.log('ORACLE OK');
}
main();
