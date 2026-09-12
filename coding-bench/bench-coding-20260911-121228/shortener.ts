import { randomBytes } from 'crypto';

/**
 * Generate a random alphanumeric code of exactly the specified length.
 * Uses only the Node.js standard library (crypto.randomBytes).
 */
export function makeCode(length: number): string {
  if (length <= 0) {
    throw new Error('Length must be positive');
  }
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  // 3 random bytes per character gives enough entropy for a 6-char code
  const bytes = randomBytes(length * 3);
  let code = '';
  for (let i = 0; i < length; i++) {
    code += chars[bytes[i] % chars.length];
  }
  return code;
}

/**
 * Check if a given string is a valid code (exactly 6 alphanumeric characters).
 */
export function isValidCode(code: string): boolean {
  if (typeof code !== 'string') return false;
  return code.length === 6 && /^[a-zA-Z0-9]{6}$/.test(code);
}
