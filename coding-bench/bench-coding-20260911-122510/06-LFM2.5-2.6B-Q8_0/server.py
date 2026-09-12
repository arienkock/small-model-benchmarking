#!/usr/bin/env python3
"""Notes web application with persistent storage using only the Python standard library."""

import json
import os
import uuid
import http.server
import socketserver
from typing import Any, Dict, List

NOTE_FILE = "notes.json"

# Load notes from disk, or create an empty list if the file doesn't exist
def load_notes() -> List[Dict[str, Any]]:
    if not os.path.exists(NOTE_FILE):
        return []
    with open(NOTE_FILE, "r") as f:
        return json.load(f)

# Save notes to disk
def save_notes(notes: List[Dict[str, Any]]) -> None:
    with open(NOTE_FILE, "w") as f:
        json.dump(notes, f, indent=2)


class NotesHandler(http.server.BaseHTTPRequestHandler):
    def do_GET(self) -> None:
        if self.path == "/api/notes":
            notes = load_notes()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"notes": notes}).encode())
        else:
            self.send_response(404)
            self.end_headers()

    def do_POST(self) -> None:
        if self.path == "/api/notes":
            content_length = int(self.headers.get("Content-Length", 0))
            if content_length == 0:
                self.send_response(400)
                self.end_headers()
                return
            body = self.rfile.read(content_length)
            try:
                data = json.loads(body)
                if "title" not in data or "body" not in data:
                    self.send_response(400)
                    self.end_headers()
                    return
                note = {
                    "id": str(uuid.uuid4()),
                    "title": data["title"],
                    "body": data["body"],
                }
                notes = load_notes()
                notes.append(note)
                save_notes(notes)
                self.send_response(201)
                self.end_headers()
            except (json.JSONDecodeError, KeyError):
                self.send_response(400)
                self.end_headers()
        else:
            self.send_response(404)
            self.end_headers()

    def log_message(self, format, *args) -> None:
        # Suppress default log messages
        pass


def main() -> None:
    port = 8080
    with socketserver.TCPServer(("", port), NotesHandler) as httpd:
        print(f"Notes server running on http://localhost:{port}")
        httpd.serve_forever()

if __name__ == "__main__":
    main()
