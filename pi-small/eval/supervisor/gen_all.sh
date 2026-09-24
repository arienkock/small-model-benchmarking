#!/bin/bash
# Serve each corpus model in turn on the laptop and have it write 5 checklists per task prompt.
set -u
cd "$(dirname "$0")"
for alias in ${ALIASES:-Granite-4.2-3B-Q8_0 Spark-X2.5-4B-Q6_K Nanbeige4.2-3B-Q6_K LFM2.5-2.6B-Q8_0 MiniCPM5-2B-Q8_0}; do #-X2.5-4B-Q6_K Nanbeige4.2-3B-Q6_K LFM2.5-2.6B-Q8_0 MiniCPM5-2B-Q8_0; do
  echo "=== $alias $(date +%T)"
  # serve.mjs leaves llama-server detached, and Windows sshd holds the session open while it
  # lives, so the ssh never returns: wait for the right model to answer, then drop the client.
  ssh benchlaptop "cd /d/llama.cpp/pi-small && node serve.mjs $alias > /d/sup-bakeoff/serve.log 2>&1 < /dev/null" < /dev/null &
  sshpid=$!
  until curl -s -m 5 -H "authorization: Bearer sk-bench" http://127.0.0.1:18123/v1/models | grep -q "\"$alias\"" \
        && ssh benchlaptop "grep -q 'verified\|already serving' /d/sup-bakeoff/serve.log" < /dev/null; do
    kill -0 $sshpid 2>/dev/null || ssh benchlaptop "grep -q 'verified\|already serving' /d/sup-bakeoff/serve.log" < /dev/null || { echo "SERVE FAILED $alias"; break; }
    sleep 10
  done
  kill $sshpid 2>/dev/null
  ssh benchlaptop "tail -3 /d/sup-bakeoff/serve.log" < /dev/null
  python3 gen_checks.py "$alias" --n 5 || echo "GEN FAILED $alias"
done
echo "=== done $(date +%T)"
