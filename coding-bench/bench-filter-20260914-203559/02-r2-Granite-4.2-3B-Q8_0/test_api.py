import json
import urllib.request
import urllib.error


def make_request(num):
    url = 'http://localhost:8000/api/time'
    req = urllib.request.Request(url)
    try:
        with urllib.request.urlopen(req, timeout=5) as resp:
            status = resp.status
            body = resp.read().decode()
            return status, body
    except urllib.error.HTTPError as e:
        status = e.code
        body = e.reason or json.loads(e.read().decode())
        return status, body
    except Exception as e:
        return None, str(e)


# Make 6 requests
responses = []
for i in range(1, 7):
    status, body = make_request(i)
    responses.append((status, body))
    print(f"Request {i}: status={status}")
    if body:
        try:
            print(f"  Body: {json.loads(body)}")
        except:
            print(f"  Body: {body}")

# Verify results
assert responses[0][0] == 200, "First request should be 200"
assert responses[1][0] == 200, "Second request should be 200"
assert responses[2][0] == 200, "Third request should be 200"
assert responses[3][0] == 200, "Fourth request should be 200"
assert responses[4][0] == 200, "Fifth request should be 200"
assert responses[5][0] == 429, "Sixth request should be 429"

print("\nAll tests passed!")
