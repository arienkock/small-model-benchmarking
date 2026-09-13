#!/usr/bin/env python3
import requests
import time

base_url = "http://localhost:8000/api/time"

# Make 6 requests with a small delay between them
for i in range(1, 7):
    print(f"\n--- Request {i} ---")
    resp = requests.get(base_url, timeout=5)
    print(f"Status: {resp.status_code}")
    print(f"Response: {resp.json()}")
    if i < 6:
        # Small delay between requests
        time.sleep(0.2)
