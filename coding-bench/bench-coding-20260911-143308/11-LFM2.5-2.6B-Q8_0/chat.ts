export interface ChatMessage {
  id: number;
  user: string;
  text: string;
}

function mergeMessages(existing: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
  const all = [...existing, ...incoming];
  const seen = new Map<number, ChatMessage>();
  const result: ChatMessage[] = [];
  
  for (const msg of all) {
    if (!seen.has(msg.id)) {
      seen.set(msg.id, msg);
      result.push(msg);
    }
  }
  
  return result;
}
