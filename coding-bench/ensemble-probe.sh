#!/usr/bin/env bash
# ensemble-probe.sh — ONE-SHOT qualitative check of the union+execution idea.
#
# Each model gets ONE tool-free completion and must return, per claimed defect,
# a DISCRIMINATING TEST: runnable code that must FAIL on the buggy module and
# PASS on a corrected one. Nothing is judged here; this script only COLLECTS.
# Adjudication happens off-box by executing every test against both versions,
# which is the whole point -- the judge is a test runner, not an opinion.
set -u
cd /d/llama.cpp/coding-bench || exit 1
LS=/d/llama.cpp/llama-server.exe
PORT=8123; KEY=sk-bench
OUT=/d/llama.cpp/coding-bench/ensemble-probe-$(date +%Y%m%d-%H%M%S)
mkdir -p "$OUT"
LOG="$OUT/run.log"
log() { echo "[$(date +%H:%M:%S)] $*" | tee -a "$LOG"; }

LOCK=/d/llama.cpp/coding-bench/.bench-lock
if ! mkdir "$LOCK" 2>/dev/null; then
  sp=$(sed -n 's/^pid: //p' "$LOCK/info" 2>/dev/null | head -1)
  if [ -n "$sp" ] && kill -0 "$sp" 2>/dev/null; then echo "FATAL: live lock pid $sp"; exit 1; fi
  log "clearing stale lock"; rm -rf "$LOCK"; mkdir "$LOCK"
fi
{ echo "pid: $$"; echo "started: $(date)"; echo "out: $OUT"; } > "$LOCK/info"

kill_server() {
  for p in $(tasklist //FI "IMAGENAME eq llama-server.exe" //FO CSV //NH 2>/dev/null | awk -F'","' '{print $2}'); do
    taskkill //F //PID "$p" >/dev/null 2>&1 || true
  done
  sleep 3
}
cleanup() { kill_server; rm -rf "$LOCK"; }
trap cleanup EXIT INT TERM

start() { # repo file alias ctx temp topk rbudget
  kill_server
  log "  loading $3 (ctx=$4 temp=$5 top_k=$6)"
  "$LS" -hf "$1" -hff "$2" --alias "$3" --jinja -c "$4" -ngl 999 --parallel 1 \
     -ctk q8_0 -ctv q8_0 --reasoning-budget "$7" --temp "$5" --top-p 0.95 --top-k "$6" \
     --api-key "$KEY" --host 127.0.0.1 --port "$PORT" > "$OUT/server-$3.log" 2>&1 &
  SRV=$!
  for i in $(seq 1 300); do
    [ "$(curl -s "http://127.0.0.1:$PORT/health" | jq -r '.status // empty' 2>/dev/null)" = "ok" ] \
      && { log "    ready in $((i*2))s"; return 0; }
    kill -0 "$SRV" 2>/dev/null || { log "    DIED"; tail -8 "$OUT/server-$3.log" | tee -a "$LOG"; return 1; }
    sleep 2
  done
  log "    TIMEOUT"; return 1
}

BUGGY='export function debounce(fn: (...args: any[]) => void, waitMs: number) {
    let timer: ReturnType<typeof setTimeout> | null = null;
    return (...args: any[]) => {
        if (timer !== null) {
            return; // already scheduled
        }
        timer = setTimeout(() => fn(args), waitMs);
        timer = null;
    };
}'

SPEC='debounce(fn, waitMs) returns a function that delays calling fn until waitMs milliseconds
have passed since the LAST call, passing through the latest arguments, and cancelling any
pending call when a new one arrives.'

ASK='You are analysing a buggy TypeScript module. Do NOT rewrite the module.

For EVERY separate defect you find, output a block in EXACTLY this format:

### DEFECT
WHY: <one sentence naming the defect and the exact wrong line>
FIX: <one sentence stating the concrete change>
TEST:
```ts
<a complete, self-contained TypeScript test file>
```

Rules for each TEST file, which are strict because the tests are executed automatically:
- It MUST import the function under test with exactly: import { debounce } from "./target.ts";
- It MUST import assert with exactly: import assert from "node:assert";
- It MUST be a DISCRIMINATING test: it has to FAIL (throw) on the buggy module above, and
  PASS on a correctly fixed module. A test that passes on the buggy module proves nothing.
- debounce is asynchronous, so you MUST wait for timers. Use:
  await new Promise(r => setTimeout(r, <ms>));
  inside a top-level async function that you then call. Waits must be comfortably longer
  than the waitMs you choose.
- On success it MUST print exactly: TEST PASSED
- On failure it MUST throw (assert does this for you). Do not catch errors.
- Use ESM only. No require, no module.exports, no __filename, no test framework.
- Keep each test under 30 lines and test ONE defect.

Output only the DEFECT blocks. No preamble, no summary, no corrected module.'

ask_model() { # alias outfile maxtok
  local alias="$1" outf="$2" mt="$3"
  jq -n --arg b "$BUGGY" --arg s "$SPEC" --arg a "$ASK" --arg m "$alias" --argjson mt "$mt" \
    '{model:$m, top_p:0.95, max_tokens:$mt,
      messages:[{role:"user",content:("Buggy module (debounce.ts):\n\n```ts\n"+$b+"\n```\n\nIntended behaviour:\n"+$s+"\n\n"+$a)}]}' \
    > "$outf.req.json"
  curl -s --max-time 3000 -H "Authorization: Bearer $KEY" -H 'Content-Type: application/json' \
    -d @"$outf.req.json" "http://127.0.0.1:$PORT/v1/chat/completions" > "$outf.resp.json"
  jq -r '.choices[0].message.content // ""' "$outf.resp.json" > "$outf.raw"
  if grep -q '</think>' "$outf.raw"; then awk 'f{print} /<\/think>/{f=1}' "$outf.raw" > "$outf"
  else cp "$outf.raw" "$outf"; fi
  log "    -> $(wc -c < "$outf") chars, $(grep -c '^### DEFECT' "$outf") defect blocks, finish=$(jq -r '.choices[0].finish_reason//"?"' "$outf.resp.json") tok=$(jq -r '.usage.completion_tokens//0' "$outf.resp.json")"
}

log "=== ensemble probe: 3 models, one completion each ==="

log "MODEL 1/3 Granite"
start ibm-granite/granite-4.2-3b-GGUF granite-4.2-3b-Q8_0.gguf Granite 16384 0.7 40 4096 \
  && { t0=$(date +%s); ask_model Granite "$OUT/defects-granite.md" 12000; log "    ${_:-}$(( $(date +%s)-t0 ))s"; }

log "MODEL 2/3 Spark"
start sizzlebop/Spark-X2.5-4B-GGUF Spark-X2.5-4B-Q6_K.gguf Spark 16384 0.7 40 4096 \
  && { t0=$(date +%s); ask_model Spark "$OUT/defects-spark.md" 12000; log "    $(( $(date +%s)-t0 ))s"; }

log "MODEL 3/3 VibeThinker (official card: temp 1.0, top_k -1, huge budget)"
start constructai/VibeThinker-3B-GGUF VibeThinker-3B-GGUF-Q8_0.gguf VibeThinker 32768 1.0 0 -1 \
  && { t0=$(date +%s); ask_model VibeThinker "$OUT/defects-vibethinker.md" 24000; log "    $(( $(date +%s)-t0 ))s"; }

kill_server
log "=== DONE. Results: $OUT ==="
