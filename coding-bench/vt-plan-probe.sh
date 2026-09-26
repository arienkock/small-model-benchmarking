#!/usr/bin/env bash
# Gate test: can VibeThinker produce a usable PLAN (prose only, no tool calls)?
set -u
cd /d/llama.cpp/coding-bench || exit 1
LS=/d/llama.cpp/llama-server.exe
PORT=8123; KEY=sk-bench
OUT=/d/llama.cpp/coding-bench/vt-plan-probe
mkdir -p "$OUT"

pkill_srv() {
  for p in $(tasklist //FI "IMAGENAME eq llama-server.exe" //FO CSV //NH 2>/dev/null | awk -F'","' '{print $2}'); do
    taskkill //F //PID "$p" >/dev/null 2>&1 || true
  done
}
pkill_srv; sleep 2

"$LS" -hf constructai/VibeThinker-3B-GGUF -hff VibeThinker-3B-GGUF-Q8_0.gguf \
  --alias VibeThinker-plan --jinja -c 16384 -ngl 999 --parallel 1 \
  --reasoning-budget 4096 --temp 0.7 --top-p 0.95 --top-k 40 \
  --api-key "$KEY" --host 127.0.0.1 --port "$PORT" > "$OUT/server.log" 2>&1 &
SRV=$!

# Poll for ACTUAL readiness: /health returns 503 {"status":"loading model"} while
# it downloads/loads, and only then {"status":"ok"}. The first probe attempt broke
# out of the loop on a 503 because curl exits 0 on any HTTP response.
READY=no
for i in $(seq 1 900); do
  st=$(curl -s "http://127.0.0.1:$PORT/health" | jq -r '.status // empty' 2>/dev/null)
  if [ "$st" = "ok" ]; then READY=yes; echo "--- ready after $((i*2))s"; break; fi
  if ! kill -0 "$SRV" 2>/dev/null; then echo "--- SERVER DIED during load"; tail -20 "$OUT/server.log"; exit 1; fi
  sleep 2
done
[ "$READY" = yes ] || { echo "--- TIMEOUT waiting for model"; tail -20 "$OUT/server.log"; pkill_srv; exit 1; }

TASK=$(cat <<'T'
Find the bug in this TypeScript module and provide the corrected version.

// debounce.ts
export function debounce(fn: (...args: any[]) => void, waitMs: number) {
    let timer: ReturnType<typeof setTimeout> | null = null;
    return (...args: any[]) => {
        if (timer !== null) {
            return; // already scheduled
        }
        timer = setTimeout(() => fn(args), waitMs);
        timer = null;
    };
}

Intended behavior: debounce(fn, waitMs) returns a function that delays calling fn until
waitMs ms have passed since the LAST call, passing through the latest arguments, and
cancelling any pending call when a new one arrives.
T
)

jq -n --arg t "$TASK" '{
  model:"VibeThinker-plan", temperature:0.7, top_p:0.95, top_k:40, max_tokens:3000,
  messages:[
    {role:"system",content:"You are a planning assistant. You do not write code and you do not call tools. You produce a numbered implementation plan for another engineer to execute."},
    {role:"user",content:($t + "\n\nProduce a numbered PLAN for a junior engineer who will make the fix. Enumerate EVERY separate defect you can find (there may be more than one), and for each say concretely what to change. Then list the specific behaviors their self-test must assert. Do not write the corrected code.")}
  ]}' > "$OUT/req.json"

curl -s -H "Authorization: Bearer $KEY" -H 'Content-Type: application/json' \
  -d @"$OUT/req.json" "http://127.0.0.1:$PORT/v1/chat/completions" > "$OUT/resp.json"

echo "=== finish_reason / usage ==="
jq -r '{finish:.choices[0].finish_reason, completion_tokens:.usage.completion_tokens}' "$OUT/resp.json" 2>/dev/null
echo "=== reasoning_content length ==="
jq -r '(.choices[0].message.reasoning_content // "") | length' "$OUT/resp.json" 2>/dev/null
echo "=== content ==="
jq -r '.choices[0].message.content // "(none)"' "$OUT/resp.json" 2>/dev/null
pkill_srv
