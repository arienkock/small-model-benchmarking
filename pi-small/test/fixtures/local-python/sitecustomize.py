# Loaded only by `workflow-e2e.ts --local`. On macOS, http.server's bind calls
# socket.getfqdn(), a reverse lookup that can take seconds per server start;
# the scripted tests start many servers and would hit the suite time limit.
import socket

socket.getfqdn = lambda name="": name or "localhost"
