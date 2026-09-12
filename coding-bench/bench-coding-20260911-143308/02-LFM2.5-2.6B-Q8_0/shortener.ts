import { random } from "crypto";

/**
 * Generate a random alphanumeric code of exactly the given length.
 * Uses Node.js built-in crypto module (available in Node 24+).
 */
export function makeCode(length: number): string {
    if (length <= 0) {
        throw new Error('Length must be positive');
    }
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    let result = "";
    for (let i = 0; i < length; i++) {
        result += chars[randomInt(0, chars.length - 1)];
    }
    return result;
}

/**
 * Generate a random alphanumeric code of exactly the given length.
 * Uses Node.js built-in crypto module (available in Node 24+).
 */
export function isValidCode(code: string): boolean {
    if (code.length !== 6) return false;
    const pattern = /^[a-zA-Z0-9]{6}$/;
    return pattern.test(code);
}

/**
 * Helper: generate a random index in [0, max] using crypto.randomInt.
 */
function randomInt(min: number, max: number): number {
    return Math.floor(random() * (max - min + 1)) + min;
}
