import { searchNotes } from "./notes";

describe("searchNotes", () => {
  const notes: Note[] = [
    { id: 1, title: "Introduction to LLMs", body: "LLMs are large language models..." },
    { id: 2, title: "Python Tips", body: "Python is a great programming language..." },
    { id: 3, title: "Web Development", body: "Building web apps with TypeScript..." },
  ];

  it("should return all notes when query is empty", () => {
    const result = searchNotes(notes, "");
    expect(result).toHaveLength(3);
    expect(result[0].id).toBe(1);
    expect(result[1].id).toBe(2);
    expect(result[2].id).toBe(3);
  });

  it("should find notes containing the word 'python'", () => {
    const result = searchNotes(notes, "python");
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe("Python Tips");
  });

  it("should find notes containing the word 'llm'", () => {
    const result = searchNotes(notes, "llm");
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe("Introduction to LLMs");
  });

  it("should return empty array for unrelated query", () => {
    const result = searchNotes(notes, "javascript");
    expect(result).toHaveLength(0);
  });
});
