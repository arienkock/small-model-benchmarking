import json
import uuid
import time
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs

# In-memory storage for messages
messages = []
next_id = 1


def get_next_id():
    global next_id
    msg = {"id": next_id, "user": "", "text": ""}
    messages.append(msg)
    next_id += 1
    return msg["id"]


def get_messages_since(since: int):
    """Return messages with id > since, oldest first."""
    return [msg for msg in messages if msg["id"] > since]


class MessageHandler(BaseHTTPRequestHandler):
    def do_POST(self):
        if self.path == "/api/messages":
            content_length = int(self.headers.get("Content-Length", 0))
            if content_length == 0:
                self.send_error(400, "No data provided")
                return
            
            try:
                body = json.loads(self.rfile.read(content_length))
                if "user" not in body or "text" not in body:
                    self.send_error(400, "Missing user or text")
                    return
                
                msg = {
                    "id": get_next_id(),
                    "user": body["user"],
                    "text": body["text"]
                }
                messages.append(msg)
                self.send_response(201)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps(msg).encode())
            except json.JSONDecodeError:
                self.send_error(400, "Invalid JSON")
        else:
            self.send_error(404, "Not found")

    def do_GET(self):
        if self.path == "/api/messages":
            query = parse_qs(self.path)
            since = query.get("since")
            if since is not None:
                try:
                    since_int = int(since)
                except ValueError:
                    self.send_error(400, "since must be an integer")
                    return
            else:
                since_int = None
            
            messages_list = get_messages_since(since_int)
            response = {"messages": messages_list}
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps(response).encode())
        else:
            self.send_error(404, "Not found")

    def log_message(self, format, *args):
        # Suppress default log messages
        pass


def main():
    server = HTTPServer(("0.0.0.0", 8080), MessageHandler)
    print("Server running on http://0.0.0.0:8080")
    server.serve_forever()

if __name__ == "__main__":
    main()
