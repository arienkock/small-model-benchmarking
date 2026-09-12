import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


NOTES_FILE = "notes.json"


def load_notes():
    if os.path.exists(NOTES_FILE):
        with open(NOTES_FILE, "r") as f:
            return json.load(f)
    return []


def save_notes(notes):
    with open(NOTES_FILE, "w") as f:
        json.dump(notes, f, indent=2)


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/api/notes":
            notes = load_notes()
            body = json.dumps({"notes": notes}).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        else:
            self.send_response(404)
            self.end_headers()

    def do_POST(self):
        if self.path == "/api/notes":
            length = int(self.headers.get("Content-Length", 0))
            data = json.loads(self.rfile.read(length))
            notes = load_notes()
            new_id = max(notes, key=lambda n: n["id"])["id"] + 1 if notes else 1
            notes.append({"id": new_id, "title": data["title"], "body": data["body"]})
            save_notes(notes)
            body = json.dumps({"notes": notes}).encode()
            self.send_response(201)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        else:
            self.send_response(404)
            self.end_headers()

    def log_message(self, format, *args):
        pass


if __name__ == "__main__":
    server = ThreadingHTTPServer(("", 8080), Handler)
    server.serve_forever()
