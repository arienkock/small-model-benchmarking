import { validateEntry } from './validateEntry';

describe('validateEntry', () => {
    test('valid entry should be accepted', () => {
        const result = validateEntry('Alice', 'Hello world!');
        expect(result.ok).toBe(true);
    });

    test('name too short should be rejected', () => {
        const result = validateEntry('A', 'Message');
        expect(result.ok).toBe(false);
        expect(result.error).toBe('Name must be 1-40 characters');
    });

    test('name too long should be rejected', () => {
        const result = validateEntry('A'.repeat(41), 'Message');
        expect(result.ok).toBe(false);
        expect(result.error).toBe('Name must be 1-40 characters');
    });

    test('empty name should be rejected', () => {
        const result = validateEntry('', 'Message');
        expect(result.ok).toBe(false);
        expect(result.error).toBe('Name must be 1-40 characters');
    });

    test('empty message should be rejected', () => {
        const result = validateEntry('Bob', '');
        expect(result.ok).toBe(false);
        expect(result.error).toBe('Message must be 1-200 characters');
    });

    test('message too long should be rejected', () => {
        const result = validateEntry('Charlie', 'A'.repeat(201));
        expect(result.ok).toBe(false);
        expect(result.error).toBe('Message must be 1-200 characters');
    });

    test('both name and message valid should be accepted', () => {
        const result = validateEntry('Dave', 'This is a valid message.');
        expect(result.ok).toBe(true);
    });
});
