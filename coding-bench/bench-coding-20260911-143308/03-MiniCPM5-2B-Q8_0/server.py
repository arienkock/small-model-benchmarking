#!/usr/bin/env python3
"""Temperature conversion web service using only the Python standard library."""

import json
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import urlparse, parse_qs


def _parse_body(path):
    parsed = urlparse(path)
    qs = parse_qs(parsed.query)
    return qs.get("value", [None])[0], qs.get("from", [None])[0], qs.get("to", [None])[0]


def _validate(value, from_unit, to_unit):
    if from_unit is None or to_unit is None:
        return "Missing from/to unit"
    if from_unit not in ("C", "F", "K"):
        return "Unknown from unit"
    if to_unit not in ("C", "F", "K"):
        return "Unknown to unit"
    try:
        float(value)
    except (TypeError, ValueError):
        return "Non-numeric value"
    return None


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        path = self.path
        import sys
        print("PATH:", path, file=sys.stderr)
        if path == "/api/convert":
            value, from_unit, to_unit = _parse_body(path)
            err = _validate(value, from_unit, to_unit)
            if err:
                body = json.dumps({"error": err}).encode()
                self.send_response(400)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(body)
                return
            result = convert(value, from_unit, to_unit)
            body = json.dumps({"value": result, "unit": to_unit}).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(body)
            return
        self.send_response(404)
        self.end_headers()

    def log_message(self, fmt, *args):
        pass


def convert(value, from_unit, to_unit):
    v = float(value)
    if from_unit == to_unit:
        return v
    if from_unit == "C":
        if to_unit == "F":
            return (v * 9 / 5) + 32
        if to_unit == "K":
            return v + 273.15
    if from_unit == "F":
        if to_unit == "C":
            return (v - 32) * 5 / 9
        if to_unit == "K":
            return (v - 32) * 5 / 9 + 273.15
    if from_unit == "K":
        if to_unit == "C":
            return v - 273.15
        if to_unit == "F":
            return (v - 273.15) * 9 / 5 + 32
    raise ValueError("Invalid conversion")


if __name__ == "__main__":
    server = HTTPServer(("0.0.0.0", 8000), Handler)
    print("Serving on port 8000")
    server.serve_forever()
