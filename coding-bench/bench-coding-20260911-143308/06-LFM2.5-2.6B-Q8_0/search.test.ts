import { searchNotes } from "./notes";

describe("searchNotes", () => {
  it("should return all notes when query is empty", () => {
    const notes: Note[] = [
      { id: 1, title: "First note", body: "This is the first note." },
      { id: 2, title: "Second note", body: "This is the second note." },
    ];
    const result = searchNotes(notes, "");
    expect(result).toHaveLength(2);
    expect(result[0].title).toBe("First note");
    expect(result[1].title).toBe("Second note");
  });

  it("should find notes containing a query in title", () => {
    const notes: Note[] = [
      { id: 1, title: "Python tips", body: "Learn Python well." },
      { id: 2, title: "JavaScript guide", body: "JavaScript is fun." },
      { id: 3, title: "Data structures", body: "Study data structures." },
    ];
    const result = searchNotes(notes, "python");
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe("Python tips");
  });

  it("should find notes containing a query in body", () => {
    const notes: Note[] = [
      { id: 1, title: "Note one", body: "This note has body text." },
      { id: 2, title: "Note two", body: "Another body content here." },
    ];
    const result = searchNotes(notes, "body");
    expect(result).toHaveLength(2);
  });

  it("should return empty array for non-matching query", () => {
    const notes: Note[] = [
      { id: 1, title: "Python", body: "Learn Python." },
    ];
    const result = searchNotes(notes, "java");
    expect(result).toHaveLength(0);
  });
});
