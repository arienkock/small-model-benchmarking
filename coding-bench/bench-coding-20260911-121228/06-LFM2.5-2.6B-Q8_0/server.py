import json
import os
import uuid
from http.server import HTTPServer, BaseHTTPRequestHandler

NOTES_FILE = "notes.json"

# Load notes from disk, or start with empty list
if os.path.exists(NOTES_FILE):
    with open(NOTES_FILE, "r") as f:
        notes = json.load(f)
else:
    notes = []


class NotesHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/api/notes":
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            response = {"notes": notes}
            self.wfile.write(json.dumps(response).encode())
        else:
            self.send_response(404)
            self.end_headers()

    def do_POST(self):
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
                    "body": data["body"]
                }
                notes.append(note)
                with open(NOTES_FILE, "w") as f:
                    json.dump(notes, f, indent=2)
                self.send_response(201)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps({"id": note["id"]}).encode())
            except (json.JSONDecodeError, KeyError):
                self.send_response(400)
                self.end_headers()
        else:
            self.send_response(404)
            self.end_headers()

    def log_message(self, format, *args):
        # Suppress default logging
        pass


def main():
    server = HTTPServer(("0.0.0.0", 8080), NotesHandler)
    print("Server running on http://0.0.0.0:8080")
    server.serve_forever()

if __name__ == "__main__":
    main()
