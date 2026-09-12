export interface TokenPayload {
  user: string;
  exp: number;
}

export function parseToken(token: string): TokenPayload | null {
  const decoded = Buffer.from(token, 'base64');
  try {
    const json = decoded.toString('utf-8');
    const payload = JSON.parse(json);
    if (typeof payload.user === 'string' && typeof payload.exp === 'number') {
      return payload;
    }
  } catch {
    /* silently return null on any malformed input */
  }
  return null;
}

// Small self-test
const tests = [
  {
    input: 'eyJyb2xlIjoiZm9sZGVyIn0',
    expected: { user: 'alice', exp: 1712673600 },
  },
  {
    input: 'invalid!',
    expected: null,
  },
  {
    input: 'eyJyb2xlIjoiZm9sZGVyIn0.bad',
    expected: null,
  },
];

for (const { input, expected } of tests) {
  console.log(`Input: "${input}"`);
  console.log(`Result: ${JSON.stringify(parseToken(input))}`);
  console.log(`Expected: ${JSON.stringify(expected)}`);
  console.log(`Pass: ${JSON.stringify(parseToken(input)) === JSON.stringify(expected)}`);
  console.log('');
}
