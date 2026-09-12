import json
import string
import http.server
import socketserver
import sys


# In-memory storage: code -> url
_storage = {}


def make_code(length=6):
    """Generate a random alphanumeric code of exactly `length` chars."""
    chars = string.ascii_letters + string.digits
    return ''.join(chars[random.choice] for _ in range(length))


# Use random.choice directly
import random


class Handler(http.server.BaseHTTPRequestHandler):
    def _send_json(self, obj):
        body = json.dumps(obj).encode()
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        if self.path == '/shorten':
            try:
                # Read all body data
                content_length = int(self.headers.get('Content-Length', 0))
                body = self.rfile.read(content_length)
                data = json.loads(body.decode())
                url = data['url']
                code = make_code()
                _storage[code] = url
                self._send_json({'code': code, 'url': url})
            except Exception as e:
                self._send_json({'error': str(e)})
        else:
            self.send_response(404)
            self.end_headers()

    def do_GET(self):
        if self.path.startswith('/'):
            code = self.path[1:]
            if code in _storage:
                url = _storage[code]
                self.send_response(302)
                self.send_header('Location', url)
                self.end_headers()
            else:
                self.send_response(404)
                self.end_headers()


class ThreadedHTTPServer(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True


if __name__ == '__main__':
    server = ThreadedHTTPServer(('localhost', 8080), Handler)
    server.serve_forever()
