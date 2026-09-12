// Token payload interface and parser

export interface TokenPayload {
  user: string;
  exp: number;
}

/**
 * Parse a base64-encoded token and return the decoded payload.
 * Returns null if the token is malformed or cannot be decoded.
 */
export function parseToken(token: string): TokenPayload | null {
  try {
    const decoded = Buffer.from(token, "base64").toString("utf-8");
    const payload = JSON.parse(decoded);
    if (payload && typeof payload.user === "string" && typeof payload.exp === "number") {
      return payload;
    }
    return null;
  } catch (err) {
    return null;
  }
}

// Self-test: verify the parser works correctly
if (process.argv.includes("parseToken.ts")) {
  // Test valid token
  const validToken = parseToken("eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c");
  console.log("Valid token parsed:", validToken);
  
  // Test tampered token
  const tamperedToken = "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c%00";
  console.log("Tampered token result:", parseToken(tamperedToken));
  
  // Test malformed token
  const malformedToken = "not-a-base64-string";
  console.log("Malformed token result:", parseToken(malformedToken));
}
