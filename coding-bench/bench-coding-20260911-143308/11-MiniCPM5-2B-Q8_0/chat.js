"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.mergeMessages = mergeMessages;
function mergeMessages(existing, incoming) {
    const seen = new Set();
    const result = [];
    for (const msg of incoming) {
        if (!seen.has(msg.id)) {
            seen.add(msg.id);
            result.push(msg);
        }
    }
    for (const msg of existing) {
        if (!seen.has(msg.id)) {
            seen.add(msg.id);
            result.push(msg);
        }
    }
    result.sort((a, b) => a.id - b.id);
    return result;
}
