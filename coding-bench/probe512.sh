#!/usr/bin/env bash
# Does --run-mode loop call tools now that the prompt budget is not broken?
# The earlier loop test ran at 16384, where the FIRST assembly overflowed, so
# it never had a chance to dispatch anything.
set -uo pipefail
cd /d/llama.cpp/coding-bench
WS=/d/llama.cpp/smallctl-container/probe512; rm -rf "$WS"; mkdir -p "$WS"
RULES="$(awk '/^APPEND_SYSTEM="/{f=1; sub(/^APPEND_SYSTEM="/,"")} f{cont=/\\$/; sub(/[[:space:]]*\\$/,""); if(!cont){sub(/"[[:space:]]*$/,""); print; exit} print}' run-filter-bench.sh)"
awk '/^===PROMPT===$/{exit} {print}' prompts-filter.txt > "$WS/prompt.txt"

taskkill //F //IM llama-server.exe >/dev/null 2>&1; sleep 2
../llama-server.exe -hf sizzlebop/Spark-X2.5-4B-GGUF -hff Spark-X2.5-4B-Q6_K.gguf \
  --alias Spark-X2.5-4B-Q6_K --jinja -c 24576 -ngl 999 --parallel 1 \
  --reasoning-budget 512 --temp 0.7 --top-p 0.95 --top-k 40 \
  --api-key sk-bench --host 0.0.0.0 --port 8123 > "$WS/server.log" 2>&1 &
for _ in $(seq 1 150); do
  curl -s -m 3 -H "Authorization: Bearer sk-bench" http://127.0.0.1:8123/health | grep -q '"status":"ok"' && break; sleep 2; done

for MODE in loop; do
  rm -rf "$WS/logs" "$WS/.smallctl" "$WS"/*.ts
  echo "########## run-mode=$MODE ##########"
  MSYS_NO_PATHCONV=1 timeout -k 10 -s TERM 480 docker run --rm --name "probe-$MODE" \
    --add-host host.docker.internal:host-gateway \
    -v "$(cygpath -w $WS)":/work -w /work \
    -e SMALLCTL_ENDPOINT=http://host.docker.internal:8123/v1 \
    -e SMALLCTL_MODEL=Spark-X2.5-4B-Q6_K -e SMALLCTL_API_KEY=sk-bench \
    smallctl:pinned --run-mode "$MODE" --provider-profile llamacpp --reasoning-mode auto \
      --context-limit 24576 --max-prompt-tokens 24576 --reserve-completion-tokens 5120 \
      --task "$(cat "$WS/prompt.txt")

$RULES" < /dev/null > "$WS/out-$MODE.log" 2> "$WS/err-$MODE.log"
  echo "rc=$?"
  docker rm -f "probe-$MODE" >/dev/null 2>&1
  echo "debounce.ts: $(ls "$WS"/debounce.ts 2>/dev/null || echo NONE)"
  echo "tools: $(grep -hoE '"tool_name": "[a-z_]+"' "$WS"/logs/*/tools.jsonl 2>/dev/null | sort | uniq -c | sort -rn | tr '\n' ' ')"
  echo "content-vs-thinking: $(grep -o 'thinking token\|model_token' "$WS"/logs/*/model_output.jsonl 2>/dev/null | sort | uniq -c | tr '\n' ' ')"
echo "status: $(grep -ho '"final_task_status": "[a-z_]*"' "$WS"/logs/*/task_summary.json 2>/dev/null | head -1)"
done
taskkill //F //IM llama-server.exe >/dev/null 2>&1
echo PROBE_DONE
