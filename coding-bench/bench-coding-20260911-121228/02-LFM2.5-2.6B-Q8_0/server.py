import json
import uuid
import hashlib
import re
from http.server import HTTPServer, BaseHTTPRequestHandler

# In-memory storage: code -> url mapping
url_store = {}


def generate_code(length: int = 6) -> str:
    """Generate a random alphanumeric code of exactly length characters."""
    # Use only standard library: random and string
    import random
    chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
    return ''.join(random.choice(chars) for _ in range(length))


def is_valid_code(code: str) -> bool:
    """Check if code is exactly 6 characters from [a-zA-Z0-9]."""
    return len(code) == 6 and re.fullmatch(r'[a-zA-Z0-9]{6}', code) is not None


class RequestHandler(BaseHTTPRequestHandler):
    def do_POST(self):
        if self.path == '/shorten':
            content_length = int(self.headers.get('Content-Length', 0))
            if content_length > 0:
                body = self.rfile.read(content_length)
                try:
                    data = json.loads(body)
                    url = data.get('url')
                    if not url or not isinstance(url, str):
                        self.send_error(400, 'Missing or invalid "url" field')
                        return
                    # Generate a 6-character code
                    code = generate_code(6)
                    # Store in memory
                    url_store[code] = url
                    # Respond with 201 Created
                    self.send_response(201)
                    self.send_header('Content-Type', 'application/json')
                    self.end_headers()
                    response = {'code': code, 'url': url}
                    self.wfile.write(json.dumps(response).encode())
                except json.JSONDecodeError:
                    self.send_error(400, 'Invalid JSON')
            else:
                self.send_error(400, 'Missing body')
        else:
            self.send_error(404, 'Not found')

    def do_GET(self):
        if self.path.startswith('/'):
            # Extract code from path
            code = self.path.split('/')[-1]
            if code in url_store:
                url = url_store[code]
                # 302 Found with Location header
                self.send_response(302)
                self.send_header('Location', url)
                self.end_headers()
            else:
                # Unknown code
                self.send_response(404)
                self.send_header('Content-Type', 'text/plain')
                self.end_headers()
                self.wfile.write(b'Not found')
        else:
            self.send_error(404, 'Not found')

    def log_message(self, format, *args):
        # Suppress default logging
        pass


def run_server():
    server = HTTPServer(('', 8080), RequestHandler)
    print('Server running on http://localhost:8080')
    server.serve_forever()


if __name__ == '__main__':
    run_server()
