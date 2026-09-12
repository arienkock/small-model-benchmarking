import socket
import json
import time

s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
s.connect(('localhost', 8080))

request = """POST /shorten HTTP/1.1\r\n
Host: localhost:8080\r\n
Content-Type: application/json\r\n
Content-Length: 32\r\n
Connection: close\r\n
\r\n
{"url": "http."}
"""
print("Sending request...")
s.send(request.encode())

response = b""
while True:
    data = s.recv(4096)
    if not data:
        break
    response += data
    if b'\r\n\r\n' in data:
        break

print("Response:")
print(response.decode(errors='replace'))
s.close()
