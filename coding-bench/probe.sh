#!/usr/bin/env bash
# Does --run-mode loop call tools now that the prompt budget is not broken?
# The earlier loop test ran at 16384, where the FIRST assembly overflowed, so
# it never had a chance to dispatch anything.
set -uo pipefail
cd /d/llama.cpp/coding-bench
WS=/d/llama.cpp/smallctl-container/probe; rm -rf "$WS"; mkdir -p "$WS"
RULES="$(awk '/^APPEND_SYSTEM="/{f=1; sub(/^APPEND_SYSTEM="/,"")} f{cont=/\\$/; sub(/[[:space:]]*\\$/,""); if(!cont){sub(/"[[:space:]]*$/,""); print; exit} print}' run-filter-bench.sh)"
awk '/^===PROMPT===$/{exit} {print}' prompts-filter.txt > "$WS/prompt.txt"

taskkill //F //IM llama-server.exe >/dev/null 2>&1; sleep 2
../llama-server.exe -hf ibm-granite/granite-4.2-3b-GGUF -hff granite-4.2-3b-Q8_0.gguf \
  --alias Granite-4.2-3B-Q8_0 --jinja -c 24576 -ngl 999 --parallel 1 \
  --reasoning-budget 4096 --temp 0.7 --top-p 0.95 --top-k 40 \
  --api-key sk-bench --host 0.0.0.0 --port 8123 > "$WS/server.log" 2>&1 &
for _ in $(seq 1 150); do
  curl -s -m 3 -H "Authorization: Bearer sk-bench" http://127.0.0.1:8123/health | grep -q '"status":"ok"' && break; sleep 2; done

for MODE in loop planning; do
  rm -rf "$WS/logs" "$WS/.smallctl" "$WS"/*.ts
  echo "########## run-mode=$MODE ##########"
  MSYS_NO_PATHCONV=1 timeout -k 10 -s TERM 420 docker run --rm --name "probe-$MODE" \
    --add-host host.docker.internal:host-gateway \
    -v "$(cygpath -w $WS)":/work -w /work \
    -e SMALLCTL_ENDPOINT=http://host.docker.internal:8123/v1 \
    -e SMALLCTL_MODEL=Granite-4.2-3B-Q8_0 -e SMALLCTL_API_KEY=sk-bench \
    smallctl:pinned --run-mode "$MODE" --provider-profile llamacpp --reasoning-mode auto \
      --context-limit 24576 --max-prompt-tokens 24576 --reserve-completion-tokens 5120 \
      --task "$(cat "$WS/prompt.txt")

$RULES" < /dev/null > "$WS/out-$MODE.log" 2> "$WS/err-$MODE.log"
  echo "rc=$?"
  docker rm -f "probe-$MODE" >/dev/null 2>&1
  echo "debounce.ts: $(ls "$WS"/debounce.ts 2>/dev/null || echo NONE)"
  echo "tools: $(grep -hoE '"tool_name": "[a-z_]+"' "$WS"/logs/*/tools.jsonl 2>/dev/null | sort | uniq -c | sort -rn | tr '\n' ' ')"
  echo "status: $(grep -ho '"final_task_status": "[a-z_]*"' "$WS"/logs/*/task_summary.json 2>/dev/null | head -1)"
done
taskkill //F //IM llama-server.exe >/dev/null 2>&1
echo PROBE_DONE
