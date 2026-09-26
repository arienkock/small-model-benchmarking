#!/usr/bin/env bash
# Smoke: Granite, task 1 (debounce -> must WRITE debounce.ts), rules appended.
set -uo pipefail
cd /d/llama.cpp/coding-bench
WS=/d/llama.cpp/smallctl-container/smoke2
rm -rf "$WS" && mkdir -p "$WS"

RULES="$(awk '/^APPEND_SYSTEM="/{f=1; sub(/^APPEND_SYSTEM="/,"")} f{cont=/\\$/; sub(/[[:space:]]*\\$/,""); if(!cont){sub(/"[[:space:]]*$/,""); print; exit} print}' run-filter-bench.sh)"
# task 1 = everything before the first ===PROMPT===
awk '/^===PROMPT===$/{exit} {print}' prompts-filter.txt > "$WS/prompt.txt"
echo "prompt chars: $(wc -c < "$WS/prompt.txt"), rules chars: ${#RULES}"

taskkill //F //IM llama-server.exe >/dev/null 2>&1; sleep 2
../llama-server.exe -hf ibm-granite/granite-4.2-3b-GGUF -hff granite-4.2-3b-Q8_0.gguf \
  --alias Granite-4.2-3B-Q8_0 --jinja -c 16384 -ngl 999 --parallel 1 \
  --reasoning-budget 4096 --temp 0.7 --top-p 0.95 --top-k 40 \
  --api-key sk-bench --host 0.0.0.0 --port 8123 > "$WS/server.log" 2>&1 &
for _ in $(seq 1 180); do
  curl -s -m 3 -H "Authorization: Bearer sk-bench" http://127.0.0.1:8123/health | grep -q '"status":"ok"' && break
  sleep 2
done
echo "server up"

MSYS_NO_PATHCONV=1 timeout -k 15 -s TERM 700 docker run --rm --name smoke2 \
  --add-host host.docker.internal:host-gateway \
  -v "$(cygpath -w $WS)":/work -w /work \
  -e SMALLCTL_ENDPOINT=http://host.docker.internal:8123/v1 \
  -e SMALLCTL_MODEL=Granite-4.2-3B-Q8_0 -e SMALLCTL_API_KEY=sk-bench \
  -e SMALLCTL_PROVIDER_PROFILE=llamacpp -e SMALLCTL_CONTEXT_LIMIT=16384 \
  -e SMALLCTL_RESERVE_COMPLETION_TOKENS=5120 \
  smallctl:pinned --provider-profile llamacpp \
    --reasoning-mode auto --context-limit 16384 --max-prompt-tokens 16384 \
    --reserve-completion-tokens 5120 --tool-profiles core,mutate \
    --task "$(cat "$WS/prompt.txt")

$RULES" < /dev/null > "$WS/transcript.jsonl" 2> "$WS/stderr.log"
echo "cell rc=$?"
docker rm -f smoke2 >/dev/null 2>&1
taskkill //F //IM llama-server.exe >/dev/null 2>&1

echo "=== DID IT WRITE debounce.ts? ==="
ls -la "$WS"/debounce.ts 2>&1 | tail -1
echo "=== status ==="
grep -ho '"final_task_status": "[a-z_]*"\|"total_tool_calls": [0-9]*' "$WS"/logs/*/task_summary.json 2>/dev/null
echo "=== tools ==="
grep -hoE '"tool_name": "[a-z_]+"' "$WS"/logs/*/tools.jsonl 2>/dev/null | sort | uniq -c | sort -rn | head -6
echo "SMOKE2_DONE"
