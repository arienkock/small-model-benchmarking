import { searchNotes, Note } from "./notes";

function main() {
  const notes: Note[] = [
    { id: 1, title: "Hello World", body: "This is a note" },
    { id: 2, title: "Goodbye World", body: "Another note" },
  ];

  const result = searchNotes(notes, "world");

  console.log("Result:", result);

  if (result.length === 2) {
    console.log("PASS: Both notes matched");
    process.exit(0);
  } else {
    console.log("FAIL: Expected 2 notes, got", result.length);
    process.exit(1);
  }
}

main();
