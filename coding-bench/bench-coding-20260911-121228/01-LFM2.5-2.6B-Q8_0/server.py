#!/usr/bin/env python3
"""Todo list server using Python standard library (http.server)."""

import json
import uuid
from http.server import HTTPServer, BaseHTTPRequestHandler

# In-memory storage for todos
todos = []
todo_id_counter = 1


class TodoHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == '/api/todos':
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            response = {'todos': todos}
            self.wfile.write(json.dumps(response).encode())
        else:
            self.send_response(404)
            self.end_headers()

    def do_POST(self):
        if self.path == '/api/todos':
            content_length = int(self.headers.get('Content-Length', 0))
            if content_length == 0:
                self.send_response(400)
                self.end_headers()
                return
            body = self.rfile.read(content_length)
            try:
                data = json.loads(body)
                if 'title' not in data:
                    self.send_response(400)
                    self.end_headers()
                    return
                todo = {
                    'id': todo_id_counter,
                    'title': data['title'],
                    'done': False
                }
                todos.append(todo)
                todo_id_counter += 1
                self.send_response(201)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps(todo).encode())
                print(f"POST todo created: {todo}")
            except (json.JSONDecodeError, KeyError) as e:
                self.send_response(400)
                self.end_headers()
                print(f"POST error: {e}")
        else:
            self.send_response(404)
            self.end_headers()

    def do_HEAD(self):
        self.send_response(200)
        self.end_headers()

    def log_message(self, format, *args):
        # Suppress default logging
        pass


def run_server(port=8000):
    server = HTTPServer(('', port), TodoHandler)
    print(f'Server running on port {port}')
    server.serve_forever()

if __name__ == '__main__':
    run_server()
