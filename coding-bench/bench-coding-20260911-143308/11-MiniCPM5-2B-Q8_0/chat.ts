export interface ChatMessage {
  id: number;
  user: string;
  text: string;
}

export function mergeMessages(existing: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
  const seen = new Set<number>();
  const result: ChatMessage[] = [];

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
