#!/usr/bin/env python3
"""HTTP server with rate-limited /api/time endpoint."""

import time
import json
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse

# Simple in-memory rate limiter: dict of IP -> (count, window_start)
# Each client gets 5 requests per 60 seconds.
rate_limit = {}


def is_rate_limited(ip: str) -> bool:
    """Check if the client has exceeded the rate limit."""
    now = time.time()
    entry = rate_limit.get(ip)
    if entry is None:
        rate_limit[ip] = [0, now]
        return False
    count, window_start = entry
    # If the window has passed, reset the counter
    if now - window_start >= 60:
        rate_limit[ip] = [count, now]
        return False
    # If at limit, return True
    if count >= 5:
        return True
    # Increment count
    rate_limit[ip][0] = count + 1
    return False


def handle_request(request: BaseHTTPRequestHandler):
    """Handle HTTP requests."""
    parsed = urlparse(request.path)
    path = parsed.path
    
    if path == "/api/time":
        # Check rate limit by client IP
        ip = request.client[0] if request.client else "unknown"
        if is_rate_limited(ip):
            response = {
                "error": "rate_limit_exceeded",
                "message": "Too many requests. Please try again later."
            }
            response["status"] = 429
            response["retry_after"] = 60
            response["headers"] = {
                "Retry-After": "60"
            }
            return response
        
        # Get current time
        now = int(time.time())
        response = {
            "now": now
        }
        response["status"] = 200
        response["headers"] = {
            "Content-Type": "application/json"
        }
        return response
    
    # For any other path, return 404
    response = {
        "error": "not_found",
        "message": "Endpoint not found"
    }
    response["status"] = 404
    response["headers"] = {
        "Content-Type": "application/json"
    }
    return response


def run_server(port: int = 8080):
    server = HTTPServer(("0.0.0.0", port), BaseHTTPRequestHandler)
    print(f"Server starting on port {port}...")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nServer stopped.")


if __name__ == "__main__":
    run_server()
