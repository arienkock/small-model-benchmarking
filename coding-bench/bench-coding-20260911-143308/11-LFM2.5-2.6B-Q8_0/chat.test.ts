import { mergeMessages } from "./chat";

describe("mergeMessages", () => {
  it("should merge two lists and remove duplicates by id", () => {
    const existing = [
      { id: 1, user: "alice", text: "Hello" },
      { id: 3, user: "bob", text: "World" },
      { id: 5, user: "charlie", text: "Test" }
    ];
    const incoming = [
      { id: 2, user: "dave", text: "Hi" },
      { id: 1, user: "alice", text: "Updated" },
      { id: 4, user: "eve", text: "Another" }
    ];
    
    const result = mergeMessages(existing, incoming);
    
    expect(result).toHaveLength(4);
    expect(result[0].id).toBe(1);
    expect(result[1].id).toBe(2);
    expect(result[2].id).toBe(3);
    expect(result[3].id).toBe(4);
    
    // id 1 should appear only once (from incoming, since it was already in existing)
    expect(result.some(m => m.id === 1)).toBe(true);
    expect(result.some(m => m.id === 2)).toBe(true);
    expect(result.some(m => m.id === 3)).toBe(true);
    expect(result.some(m => m.id === 4)).toBe(true);
  });

  it("should keep messages in ascending id order", () => {
    const existing = [
      { id: 5, user: "alice", text: "Old" },
      { id: 3, user: "bob", text: "Middle" }
    ];
    const incoming = [
      { id: 1, user: "charlie", text: "New" },
      { id: 4, user: "dave", text: "High" }
    ];
    
    const result = mergeMessages(existing, incoming);
    
    expect(result).toHaveLength(4);
    expect(result[0].id).toBe(1);
    expect(result[1].id).toBe(3);
    expect(result[2].id).toBe(4);
    expect(result[3].id).toBe(5);
  });

  it("should handle empty lists", () => {
    const result = mergeMessages([], []);
    expect(result).toHaveLength(0);
  });

  it("should handle duplicate ids correctly", () => {
    const existing = [
      { id: 10, user: "alice", text: "First" }
    ];
    const incoming = [
      { id: 10, user: "bob", text: "Second" },
      { id: 20, user: "charlie", text: "Third" }
    ];
    
    const result = mergeMessages(existing, incoming);
    
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe(10);
    expect(result[1].id).toBe(20);
    expect(result[0].user).toBe("alice"); // first occurrence wins
    expect(result[1].user).toBe("charlie");
  });
});
