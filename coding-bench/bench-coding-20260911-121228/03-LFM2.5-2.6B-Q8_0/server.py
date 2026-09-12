#!/usr/bin/env python3
"""Temperature conversion HTTP server using only the Python standard library."""

import json
import sys
from http.server import HTTPServer, BaseHTTPRequestHandler

# Conversion constants
C_TO_F = lambda c: (c * 9/5) + 32
F_TO_C = lambda f: (f - 32) * 5/9
K_TO_C = lambda k: (k - 273.15)
C_TO_K = lambda c: c + 273.15
F_TO_K = lambda f: (f - 32) * 5/9 + 273.15
K_TO_F = lambda k: (k - 273.15) * 9/5

UNIT_MAP = {
    'C': C_TO_F,
    'F': F_TO_C,
    'K': K_TO_C,
}

# Reverse mappings for validation
REVERSE_MAP = {
    'F': C_TO_F,
    'K': F_TO_K,
    'C': K_TO_F,
}


def convert_temp(value: float, from_unit: str, to_unit: str) -> float:
    """Convert temperature between Celsius, Fahrenheit, and Kelvin."""
    if from_unit not in UNIT_MAP or to_unit not in UNIT_MAP:
        raise ValueError("Unknown unit")
    if from_unit == to_unit:
        return value
    # Convert from source to Celsius first, then to target
    if from_unit == 'C':
        temp_c = value
    elif from_unit == 'F':
        temp_c = C_TO_F(value)
    elif from_unit == 'K':
        temp_c = C_TO_K(value)
    # Convert to target
    if to_unit == 'C':
        return temp_c
    elif to_unit == 'F':
        return F_TO_C(temp_c)
    elif to_unit == 'K':
        return K_TO_C(temp_c)


def is_supported_unit(unit: str) -> bool:
    """Check if a unit is supported (C, F, K)."""
    return unit in UNIT_MAP


class TempHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == '/api/convert':
            # Parse query parameters
            query = self.path.split('?')[1] if self.path.startswith('?') else ''
            if not query:
                self.send_error(400, 'Missing query parameters')
                return
            
            params = query.split('&')
            try:
                value = float(params[0])
                from_unit = params[1]
                to_unit = params[2]
            except (IndexError, ValueError) as e:
                self.send_error(400, f'Invalid query parameters: {e}')
                return
            
            if not is_supported_unit(from_unit) or not is_supported_unit(to_unit):
                self.send_error(400, 'Unknown unit')
                return
            
            try:
                result = convert_temp(value, from_unit, to_unit)
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                response = json.dumps({
                    "value": round(result, 2),
                    "unit": to_unit
                })
                self.wfile.write(response.encode())
            except ValueError as e:
                self.send_error(400, str(e))
        else:
            self.send_error(404, 'Not found')

    def log_message(self, format, *args):
        # Suppress default logging
        pass


def main():
    server = HTTPServer(('', 8080), TempHandler)
    print("Temperature conversion server starting on http://localhost:8080")
    server.serve_forever()

if __name__ == '__main__':
    main()
