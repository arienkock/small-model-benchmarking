var _notes = require("./notes");

var _notes_interface = _notes.Note;

function searchNotes(notes, query) {
  if (!query) {
    return notes;
  }
  var lower = query.toLowerCase();
  return notes.filter(function (note) {
    return (note.title.toLowerCase().includes(lower)) || (note.body.toLowerCase().includes(lower));
  });
}

module.exports = { Note: _notes_interface, searchNotes };
