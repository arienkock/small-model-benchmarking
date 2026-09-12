export interface Note {
  id: number;
  title: string;
  body: string;
}

export function searchNotes(notes: Note[], query: string): Note[] {
  const lowerQuery = query.toLowerCase();
  return notes.filter(note =>
    note.title.toLowerCase().includes(lowerQuery) ||
    note.body.toLowerCase().includes(lowerQuery)
  );
}
