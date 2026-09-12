import json
import http.server
import time

entries = []

def validate_entry(name, message):
    if not name or len(name) > 40:
        return False, "name must not be empty or longer than 40 characters"
    if not message or len(message) > 200:
        return False, "message must not be empty or longer than 200 characters"
    return True, None

class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == '/api/entries':
            response = json.dumps({"entries": entries}).encode()
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(response)
        else:
            self.send_response(404)
            self.end_headers()

    def do_POST(self):
        if self.path == '/api/entries':
            length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(length)
            try:
                data = json.loads(body)
            except json.JSONDecodeError:
                self.send_response(400)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({"error": "Invalid JSON"}).encode())
                return

            name = data.get('name', '')
            message = data.get('message', '')

            valid, error = validate_entry(name, message)
            if not valid:
                self.send_response(400)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({"error": error}).encode())
                return

            timestamp = time.time()
            entries.append({"name": name, "message": message, "timestamp": timestamp})

            self.send_response(201)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({"status": "ok"}).encode())
        else:
            self.send_response(404)
            self.end_headers()

    def log_message(self, format, *args):
        pass

if __name__ == '__main__':
    server = http.server.HTTPServer(('0.0.0.0', 8080), Handler)
    print('Serving on port 8080')
    server.serve_forever()
