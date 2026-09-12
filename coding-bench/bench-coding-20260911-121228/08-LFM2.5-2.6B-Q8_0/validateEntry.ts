import { validateEntry } from './validateEntry';

export function validateEntry(name: string, message: string): { ok: boolean; error?: string } {
    // Validate name
    if (!name || name.length > 40) {
        return {
            ok: false,
            error: 'Name must be 1-40 characters'
        };
    }

    // Validate message
    if (!message || message.length > 200) {
        return {
            ok: false,
            error: 'Message must be 1-200 characters'
        };
    }

    return { ok: true };
}
