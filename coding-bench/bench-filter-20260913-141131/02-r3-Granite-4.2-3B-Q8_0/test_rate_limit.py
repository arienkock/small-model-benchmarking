#!/usr/bin/env python3
import json
import urllib.request
import urllib.error
import time

base_url = "http://localhost:8888/api/time"

# Make 6 requests and check responses
for i in range(1, 7):
    req = urllib.request.Request(base_url)
    try:
        resp = urllib.request.urlopen(req)
        print(f"Request {i}: OK, status={resp.status}")
        if resp.status == 200:
            data = json.loads(resp.read().decode())
            print(f"  -> {data}")
        elif resp.status == 429:
            print(f"  -> 429 (rate limited)")
            # Check Retry-After header
            retry_after = resp.getheader('Retry-After')
            print(f"  -> Retry-After: {retry_after}")
    except urllib.error.HTTPError as e:
        print(f"Request {i}: HTTP {e.code}")
        if e.code == 429:
            print(f"  -> 429 (rate limited)")
            retry_after = e.headers.get('Retry-After')
            print(f"  -> Retry-After: {retry_after}")
    except Exception as e:
        print(f"Request {i}: ERROR - {e}")
