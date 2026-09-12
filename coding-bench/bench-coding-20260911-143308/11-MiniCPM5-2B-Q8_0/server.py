import json
import http.server
import socketserver


class MessagesHandler(http.server.BaseHTTPRequestHandler):
    messages = []
    next_id = 0

    def _send_json(self, data):
        body = json.dumps(data).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _parse_query(self, path):
        if "?" not in path:
            return {}
        query = path.split("?", 1)[1]
        params = {}
        for pair in query.split("&"):
            if "=" in pair:
                key, value = pair.split("=", 1)
                params[key] = value
            else:
                params[pair] = ""
        return params

    def do_POST(self):
        if self.path == "/api/messages":
            length = int(self.headers.get("Content-Length", 0))
            data = self.rfile.read(length)
            try:
                payload = json.loads(data.decode("utf-8"))
            except Exception:
                self._send_json({"error": "invalid JSON"})
                return
            user = payload.get("user", "")
            text = payload.get("text", "")
            self.next_id += 1
            msg = {"id": self.next_id, "user": user, "text": text}
            self.messages.append(msg)
            self._send_json({"status": "created", "id": self.next_id})
        else:
            self._send_json({"error": "not found"})

    def do_GET(self):
        if self.path.startswith("/api/messages"):
            params = self._parse_query(self.path)
            since = int(params.get("since", 0))
            filtered = [m for m in self.messages if m["id"] > since]
            self._send_json({"messages": filtered})
        else:
            self._send_json({"error": "not found"})


class ThreadedHTTPServer(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True


if __name__ == "__main__":
    server = ThreadedHTTPServer(("", 5000), MessagesHandler)
    print("Serving on port", server.server_address[1])
    server.serve_forever()
