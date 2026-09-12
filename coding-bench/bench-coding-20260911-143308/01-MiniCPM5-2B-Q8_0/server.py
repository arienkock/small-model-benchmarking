import json
from http.server import BaseHTTPRequestHandler, HTTPServer

_todos = []
_next_id = 1


class TodoHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == '/api/todos':
            payload = json.dumps({"todos": list(_todos)})
            self.send_response(200)
            self.send_header("Content-type", "application/json")
            self.end_headers()
            self.wfile.write(payload.encode())
        else:
            self.send_response(404)
            self.end_headers()

    def do_POST(self):
        if self.path == '/api/todos':
            length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(length)
            data = json.loads(body)
            title = data["title"]
            todo = {"id": _next_id, "title": title, "done": False}
            _todos.append(todo)
            _next_id += 1
            payload = json.dumps({"todos": list(_todos)})
            self.send_response(200)
            self.send_header("Content-type", "application/json")
            self.end_headers()
            self.wfile.write(payload.encode())
        else:
            self.send_response(404)
            self.end_headers()

    def log_message(self, fmt, *args):
        pass


def run(server_port=8000):
    server = HTTPServer(("0.0.0.0", server_port), TodoHandler)
    server.serve_forever()


if __name__ == "__main__":
    run()
