#!/usr/bin/env bash
# One-cell smoke: Granite on task 3 (the simplest), 480s cap.
# Validates: server start, container->server reach, SmallCTL emits real tool
# calls under a 4096 reasoning budget, and a deliverable lands in the workspace.
set -uo pipefail
cd /d/llama.cpp/coding-bench
rm -rf /d/llama.cpp/smallctl-container/smoke && mkdir -p /d/llama.cpp/smallctl-container/smoke
WS=/d/llama.cpp/smallctl-container/smoke

taskkill //F //IM llama-server.exe >/dev/null 2>&1; sleep 2
../llama-server.exe -hf ibm-granite/granite-4.2-3b-GGUF -hff granite-4.2-3b-Q8_0.gguf \
  --alias Granite-4.2-3B-Q8_0 --jinja -c 16384 -ngl 999 --parallel 1 \
  --reasoning-budget 4096 --temp 0.7 --top-p 0.95 --top-k 40 \
  --api-key sk-bench --host 0.0.0.0 --port 8123 > "$WS/server.log" 2>&1 &
SPID=$!

for _ in $(seq 1 180); do
  curl -s -m 3 -H "Authorization: Bearer sk-bench" http://127.0.0.1:8123/health | grep -q '"status":"ok"' && break
  sleep 2
done
echo "server up: $(curl -s -H 'Authorization: Bearer sk-bench' http://127.0.0.1:8123/props | jq -r '.default_generation_settings.n_ctx')"

# task 3 prompt
awk '/^Find the bug in this Python HTTP server/,0' prompts-filter.txt > "$WS/prompt.txt"
wc -c "$WS/prompt.txt"

MSYS_NO_PATHCONV=1 timeout -k 15 -s TERM 480 docker run --rm --name smoketest \
  --add-host host.docker.internal:host-gateway \
  -v "$(cygpath -w $WS)":/work -w /work \
  -e SMALLCTL_ENDPOINT=http://host.docker.internal:8123/v1 \
  -e SMALLCTL_MODEL=Granite-4.2-3B-Q8_0 \
  -e SMALLCTL_API_KEY=sk-bench \
  -e SMALLCTL_PROVIDER_PROFILE=llamacpp \
  -e SMALLCTL_CONTEXT_LIMIT=16384 \
  -e SMALLCTL_RESERVE_COMPLETION_TOKENS=6144 \
  smallctl:pinned --run-mode loop --provider-profile llamacpp \
    --context-limit 16384 --max-prompt-tokens 16384 \
    --reserve-completion-tokens 6144 --task "$(cat $WS/prompt.txt)" \
  < /dev/null > "$WS/transcript.jsonl" 2> "$WS/stderr.log"
echo "cell rc=$?"
docker rm -f smoketest >/dev/null 2>&1

kill $SPID 2>/dev/null; taskkill //F //IM llama-server.exe >/dev/null 2>&1

echo "=== DELIVERABLE server.py present? ==="
ls -la "$WS"/server.py 2>&1 | tail -1
echo "=== files in workspace ==="
ls -la "$WS"
echo "=== task_summary ==="
cat "$WS"/logs/*/task_summary.json 2>/dev/null | head -c 700
echo
echo "=== tool calls ==="
grep -oE '"tool_name": "[a-z_]+"' "$WS"/logs/*/tools.jsonl 2>/dev/null | sort | uniq -c | sort -rn | head
echo "SMOKE_DONE"
