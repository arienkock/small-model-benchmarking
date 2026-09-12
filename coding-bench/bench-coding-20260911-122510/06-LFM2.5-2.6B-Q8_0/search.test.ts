import { searchNotes } from "./notes";

// Helper to create a note given a title and body
def createNote(title: string, body: string): Note {
  return {
    id: Date.now(),
    title,
    body,
  };
}

// Test 1: searchNotes returns all notes when query matches nothing (empty result)
it("searchNotes returns empty array for non-matching query", () => {
  const notes: Note[] = [
    { id: 1, title: "Python tips", body: "Learn Python well" },
    { id: 2, title: "JavaScript basics", body: "JS is fun" },
  ];
  const result = searchNotes(notes, "nonexistent");
  expect(result).toEqual([]);
});

// Test 2: searchNotes returns notes when query matches title
it("searchNotes returns notes matching title", () => {
  const notes: Note[] = [
    { id: 1, title: "Python tips", body: "Learn Python well" },
    { id: 2, title: "JavaScript basics", body: "JS is fun" },
    { id: 3, title: "Data structures", body: "Arrays and lists" },
  ];
  const result = searchNotes(notes, "python");
  expect(result).toHaveLength(2);
  expect(result[0].title).toBe("Python tips");
  expect(result[1].title).toBe("JavaScript basics");
});

// Test 3: searchNotes returns notes when query matches body
it("searchNotes returns notes matching body", () => {
  const notes: Note[] = [
    { id: 1, title: "Python tips", body: "Learn Python well" },
    { id: 2, title: "JavaScript basics", body: "JS is fun" },
    { id: 3, title: "Data structures", body: "Arrays and lists" },
  ];
  const result = searchNotes(notes, "well");
  expect(result).toHaveLength(1);
  expect(result[0].title).toBe("Python tips");
});

// Test 4: searchNotes returns notes matching both title and body
it("searchNotes returns notes matching both title and body", () => {
  const notes: Note[] = [
    { id: 1, title: "Python tips", body: "Learn Python well" },
    { id: 2, title: "JavaScript basics", body: "JS is fun" },
    { id: 3, title: "Python and JS", body: "Both languages are great" },
  ];
  const result = searchNotes(notes, "python");
  expect(result).toHaveLength(2);
  expect(result[0].title).toBe("Python tips");
  expect(result[1].title).toBe("Python and JS");
});

// Test 5: searchNotes is case-insensitive
it("searchNotes is case-insensitive", () => {
  const notes: Note[] = [
    { id: 1, title: "Python Tips", body: "Learn Python well" },
    { id: 2, title: "JAVASCRIPT BASICS", body: "JS is fun" },
  ];
  const result = searchNotes(notes, "PYTHON");
  expect(result).toHaveLength(2);
});
