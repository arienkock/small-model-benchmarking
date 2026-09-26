#!/usr/bin/env bash
# Probe v2: VibeThinker as PLANNER, invoked per its OFFICIAL model card
#   temp 0.6, top_p 0.95, top_k -1 (disabled -> llama.cpp --top-k 0),
#   max_tokens large (card says 40960; we give it as much as 6 GiB allows).
# Also tests BUDGET FORCING: if it will not close <think> on its own, we
# re-prompt with the partial text + "</think>" to force a terminated plan.
set -u
cd /d/llama.cpp/coding-bench || exit 1
LS=/d/llama.cpp/llama-server.exe
PORT=8123; KEY=sk-bench
OUT=/d/llama.cpp/coding-bench/vt-plan-probe2
rm -rf "$OUT"; mkdir -p "$OUT"

pkill_srv() {
  for p in $(tasklist //FI "IMAGENAME eq llama-server.exe" //FO CSV //NH 2>/dev/null | awk -F'","' '{print $2}'); do
    taskkill //F //PID "$p" >/dev/null 2>&1 || true
  done
  sleep 3
}

start_srv() { # $1 = ctx
  pkill_srv
  "$LS" -hf constructai/VibeThinker-3B-GGUF -hff VibeThinker-3B-GGUF-Q8_0.gguf \
    --alias VT-plan --jinja -c "$1" -ngl 999 --parallel 1 \
    -ctk q8_0 -ctv q8_0 \
    --reasoning-budget -1 \
    --temp 0.6 --top-p 0.95 --top-k 0 \
    --api-key "$KEY" --host 127.0.0.1 --port "$PORT" > "$OUT/server-$1.log" 2>&1 &
  SRV=$!
  for i in $(seq 1 300); do
    st=$(curl -s "http://127.0.0.1:$PORT/health" | jq -r '.status // empty' 2>/dev/null)
    [ "$st" = "ok" ] && { echo "  ctx=$1 ready in $((i*2))s"; return 0; }
    kill -0 "$SRV" 2>/dev/null || { echo "  ctx=$1 DIED"; return 1; }
    sleep 2
  done
  echo "  ctx=$1 timeout"; return 1
}

CTX=0
for c in 32768 24576 16384; do
  if start_srv "$c"; then CTX=$c; break; fi
done
[ "$CTX" = 0 ] && { echo "FATAL: no context loaded"; exit 1; }
REAL=$(curl -s -H "Authorization: Bearer $KEY" "http://127.0.0.1:$PORT/props" | jq -r '.default_generation_settings.n_ctx // empty')
echo "=== serving ctx=$CTX (server reports n_ctx=$REAL) ==="

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
PLAN_ASK="Produce a short numbered PLAN for another engineer who will make the fix. Enumerate EVERY separate defect, and for each state concretely what to change. Then list the behaviors their self-test must assert. Do NOT write the corrected code."

MAXTOK=$(( REAL - 1200 ))
echo "=== pass 1: max_tokens=$MAXTOK ==="
jq -n --arg t "$TASK" --arg a "$PLAN_ASK" --argj 2>/dev/null x 1 '.' >/dev/null 2>&1
jq -n --arg t "$TASK" --arg a "$PLAN_ASK" --argjson mt "$MAXTOK" \
  '{model:"VT-plan", temperature:0.6, top_p:0.95, top_k:0, max_tokens:$mt,
    messages:[{role:"user",content:($t+"\n\n"+$a)}]}' > "$OUT/req1.json"
curl -s --max-time 3000 -H "Authorization: Bearer $KEY" -H 'Content-Type: application/json' \
  -d @"$OUT/req1.json" "http://127.0.0.1:$PORT/v1/chat/completions" > "$OUT/resp1.json"

jq -r '{finish:.choices[0].finish_reason, completion_tokens:.usage.completion_tokens}' "$OUT/resp1.json"
jq -r '.choices[0].message.content // ""' "$OUT/resp1.json" > "$OUT/content1.txt"
echo "content1 chars: $(wc -c < "$OUT/content1.txt")"
echo "closes </think>? : $(grep -c '</think>' "$OUT/content1.txt")"
echo "----- TAIL of pass 1 -----"
tail -c 1400 "$OUT/content1.txt"

FIN=$(jq -r '.choices[0].finish_reason' "$OUT/resp1.json")
CLOSED=$(grep -c '</think>' "$OUT/content1.txt")
if [ "$FIN" != "stop" ] || [ "$CLOSED" -eq 0 ]; then
  echo; echo "=== pass 2: BUDGET FORCING (raw /completion, inject </think>) ==="
  python3 - "$OUT" "$TASK" "$PLAN_ASK" <<'PY'
import json,sys,io,urllib.request
out,task,ask=sys.argv[1],sys.argv[2],sys.argv[3]
partial=io.open(out+"/content1.txt",encoding="utf-8",errors="replace").read()
# keep the last stretch of deliberation, then force the block closed
tailkeep=6000
partial=partial[-tailkeep:]
prompt=("<|im_start|>user\n"+task+"\n\n"+ask+"<|im_end|>\n<|im_start|>assistant\n"
        +partial+"\n</think>\n\n### PLAN\n")
body=json.dumps({"prompt":prompt,"n_predict":900,"temperature":0.6,"top_p":0.95,
                 "top_k":0,"cache_prompt":False,"stop":["<|im_end|>"]}).encode()
r=urllib.request.Request("http://127.0.0.1:8123/completion",data=body,
    headers={"Content-Type":"application/json","Authorization":"Bearer sk-bench"})
d=json.loads(urllib.request.urlopen(r,timeout=3000).read())
io.open(out+"/forced_plan.txt","w",encoding="utf-8").write(d.get("content",""))
print("forced stop_reason:",d.get("stop_type") or d.get("stopped_eos"))
print(d.get("content","")[:2500])
PY
fi
pkill_srv
echo "=== DONE ==="
