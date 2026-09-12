const { validateEntry } = require('./validate.ts');
const assert = require('assert');

const validResult = validateEntry('John Doe', 'Hello, world!');
assert.strictEqual(validResult.ok, true);

const emptyNameResult = validateEntry('', 'Hello');
assert.strictEqual(emptyNameResult.ok, false);

const longNameResult = validateEntry('a'.repeat(41), 'Hello');
assert.strictEqual(longNameResult.ok, false);

const emptyMessageResult = validateEntry('John', '');
assert.strictEqual(emptyMessageResult.ok, false);

const longMessageResult = validateEntry('John', 'm'.repeat(201));
assert.strictEqual(longMessageResult.ok, false);

console.log('All tests passed');
