export function makeCode(length: number): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let code = '';
    for (let i = 0; i < length; i++) {
        code += chars[crypto.randomInt(0, chars.length - 1)];
    }
    return code;
}

export function isValidCode(code: string): boolean {
    return code.length === 6 && /^[a-zA-Z0-9]+$/.test(code);
}
