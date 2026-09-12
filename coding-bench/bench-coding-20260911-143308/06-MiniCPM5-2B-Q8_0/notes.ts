export interface Note {
  id: number;
  title: string;
  body: string;
}

export function searchNotes(notes: Note[], query: string): Note[] {
  if (!query) {
    return notes;
  }
  const lower = query.toLowerCase();
  return notes.filter((note) =>
    note.title.toLowerCase().includes(lower) ||
    note.body.toLowerCase().includes(lower)
  );
}
