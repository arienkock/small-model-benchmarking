import urllib.request
import json

url = "http://localhost:35747/api/convert?value=25&from=C&to=F"
try:
    req = urllib.request.Request(url)
    with urllib.request.urlopen(req) as r:
        print("STATUS:", r.status)
        print(r.read().decode())
except Exception as e:
    print("error:", repr(e))
