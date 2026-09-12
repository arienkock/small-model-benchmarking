import json
import http.server
import socketserver
import urllib.parse

class TodoApp(http.server.BaseHTTPRequestHandler):
    def _send_json(self, data, status=200):
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps(data).encode("utf-8"))

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == "/api/todos":
            with open("/tmp/todos.json", "r") as f:
                data = json.load(f)
            self._send_json({"todos": data})
        else:
            self._send_json({"error": "Not Found"}, status=404)

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == "/api/todos":
            length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(length).decode("utf-8")
            data = json.loads(body)
            todos = json.load(open("/tmp/todos.json"))
            new_id = max((t["id"] for t in todos), default=0) + 1
            new_todo = {"id": new_id, "title": data["title"], "done": False}
            todos.append(new_todo)
            json.dump(todos, open("/tmp/todos.json", "w"))
            self._send_json(new_todo)
        else:
            self._send_json({"error": "Not Found"}, status=404)

    def log_message(self, fmt, *args):
        pass  # silence default logging

if __name__ == "__main__":
    with open("/tmp/todos.json", "w") as f:
        json.dump([], f)
    with socketserver.TCPServer(("0.0.0.0", 8000), TodoApp) as httpd:
        httpd.serve_forever()
