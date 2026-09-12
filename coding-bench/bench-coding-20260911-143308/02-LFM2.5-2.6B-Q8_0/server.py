import json
import uuid
import hashlib
import time
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs

# In-memory storage: code -> url mapping
url_store = {}


def generate_code(length: int = 6) -> str:
    """Generate a random alphanumeric code of exactly length characters."""
    import random
    import string
    return ''.join(random.choices(string.ascii_letters + string.digits, k=length))


def make_code(length: int) -> str:
    """Generate a random alphanumeric code of exactly the given length."""
    return generate_code(length)


def is_valid_code(code: str) -> bool:
    """Check if the code is exactly 6 characters from [a-zA-Z0-9]."""
    return len(code) == 6 and code.isalnum()


class ShortenerHandler(BaseHTTPRequestHandler):
    def do_POST(self):
        if self.path == '/shorten':
            content_length = int(self.headers.get('Content-Length', 0))
            post_data = self.rfile.read(content_length)
            try:
                data = json.loads(post_data)
                url = data.get('url')
                if not url:
                    self.send_error(400, 'Missing "url" field')
                    return
                # Generate a 6-character code
                code = make_code(6)
                # Store the URL with the code
                url_store[code] = url
                # Respond with 200 and the code + original URL
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                response = {
                    'code': code,
                    'url': url
                }
                self.wfile.write(json.dumps(response).encode())
            except json.JSONDecodeError:
                self.send_error(400, 'Invalid JSON')
        else:
            self.send_error(404, 'Not found')

    def do_GET(self):
        if self.path.startswith('/'):
            # Extract the code from the path
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
                self.end_headers()
        else:
            self.send_error(404, 'Not found')

    def log_message(self, format, *args):
        # Suppress default logging
        pass


def run_server(port: int = 8080):
    server = HTTPServer(('', port), ShortenerHandler)
    print(f'Server running on http://0.0.0.0:{port}')
    server.serve_forever()


if __name__ == '__main__':
    run_server()
