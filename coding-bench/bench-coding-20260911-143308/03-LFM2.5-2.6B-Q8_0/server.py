#!/usr/bin/env python3
"""Temperature conversion web service."""

import json
import urllib.parse
from http.server import HTTPServer, BaseHTTPRequestHandler

# Supported units
UNITS = {"C": "Celsius", "F": "Fahrenheit", "K": "Kelvin"}

def convert_temp(value: float, from_unit: str, to_unit: str) -> float:
    """Convert temperature between Celsius, Fahrenheit, and Kelvin."""
    if from_unit not in UNITS or to_unit not in UNITS:
        raise ValueError("Unknown unit")
    
    # Convert to Celsius first as intermediate
    if from_unit == "C":
        celsius = value
    elif from_unit == "F":
        celsius = (value - 32) * 5 / 9
    elif from_unit == "K":
        celsius = value - 273.15
    else:
        raise ValueError("Unknown unit")
    
    # Convert from Celsius to target unit
    if to_unit == "C":
        return celsius
    elif to_unit == "F":
        return celsius * 9 / 5 + 32
    elif to_unit == "K":
        return celsius + 273.15
    else:
        raise ValueError("Unknown unit")


def is_supported_unit(unit: str) -> bool:
    """Check if a unit is supported."""
    return unit in UNITS


class TempHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path.startswith("/api/convert"):
            # Parse query parameters
            parsed = urllib.parse.parse_qs(self.path)
            value = parsed.get("value", [None])[0]
            from_unit = parsed.get("from", [None])[0]
            to_unit = parsed.get("to", [None])[0]
            
            # Validate required parameters
            if value is None or from_unit is None or to_unit is None:
                self.send_error(400, json.dumps({"error": "Missing required parameters"}))
                return
            
            # Validate numeric value
            try:
                value = float(value)
            except (ValueError, TypeError):
                self.send_error(400, json.dumps({"error": "Value must be a number"}))
                return
            
            # Validate units
            if not is_supported_unit(from_unit) or not is_supported_unit(to_unit):
                self.send_error(400, json.dumps({"error": "Unknown unit"}))
                return
            
            # Perform conversion
            try:
                result = convert_temp(value, from_unit, to_unit)
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps({"value": result, "unit": to_unit}).encode())
            except ValueError as e:
                self.send_error(400, json.dumps({"error": str(e)}))
        else:
            self.send_error(404, "Not found")

    def log_message(self, format, *args):
        # Suppress default logging
        pass


def run_server():
    server = HTTPServer(("0.0.0.0", 8081), TempHandler)
    print("Temperature conversion server starting on http://0.0.0.0:8080")
    server.serve_forever()


if __name__ == "__main__":
    run_server()
