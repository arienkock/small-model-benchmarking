#!/usr/bin/env bash
#
# plan-assist.sh — does an explicit PLAN lift Spark on the one task it cannot
# do reliably? (filter T1, the 3-bug debounce module: Spark ships a passing
# debounce in 4 of 11 lifetime attempts across rounds 2-3'.)
#
# THREE PHASES, run in sequence because the 6144 MiB card cannot hold both
# models at once (Spark 3222 MiB + VibeThinker 3133 MiB = 6355 MiB before any
# KV cache):
#
#   1 EXPLORE   Spark investigates the buggy module empirically and writes
#               findings.md. ONE exploration per repeat, SHARED by both arms,
#               so the arms differ only in who plans (paired design, and it
#               halves the explore cost).
#   2 PLAN      vtplan   -> VibeThinker-3B, per its OFFICIAL card: temp 1.0,
#                           top_p 0.95, top_k -1 (llama.cpp: --top-k 0).
#                           Tool-free chat completion; its card explicitly
#                           rules out agentic use, and a planner needs no
#                           tool channel. Plan = text AFTER </think>.
#               selfplan -> Spark writes its own plan from the same findings,
#                           same request, harness sampling. This is the CONTROL:
#                           without it, any gain is confounded by the extra pass.
#   3 EXECUTE   Spark, normal agent loop, prompt = task + findings + plan.
#
# Workspaces are named <task>-r<rep>-<alias> so grade-run.sh grades this dir
# UNCHANGED, and the two arms appear as two "models" in GRADES.txt/STABILITY.txt.
#
# n=3 per arm is a MECHANISM probe, not a powered comparison: 3/3 against the
# 4/11 baseline is p~0.10. Read the transcripts for whether the plan was
# followed and whether all three seeded bugs got fixed.
#
# KNOWN BLIND SPOT, measured in the 2026-09-15 planner probe: VibeThinker's
# plan named the two timer defects but NOT bug 1 (fn(args) should be
# fn(...args)) -- which is Spark's most frequent failure. Bug 1 appears only
# obliquely, in the plan's self-test requirements. Whether that is enough is
# one of the things this run answers.
set -u

cd /d/llama.cpp/coding-bench || exit 1
SCRIPT_DIR=/d/llama.cpp/coding-bench
LLAMA_SERVER="$SCRIPT_DIR/../llama-server.exe"
PI_IMAGE="coding-bench-agent:latest"
EXT_WIN="$(cygpath -w "$SCRIPT_DIR/provider-extension.ts")"
GUARD_WIN="$(cygpath -w "$SCRIPT_DIR/bench-guard.ts")"
PORT=8123; HOST=0.0.0.0; API_KEY="sk-bench"

REPEATS="${PA_REPEATS:-3}"
CTX="${PA_CTX:-16384}"              # execute/explore context (harness default)
VT_CTX="${PA_VT_CTX:-32768}"        # planner gets a big window; it needs ~5k tokens
RUN_TIMEOUT="${PA_RUN_SEC:-1800}"   # per agent cell
EXPLORE_TIMEOUT="${PA_EXPLORE_SEC:-1800}"   # was 900: ALL 3 cells hit it at 903s

SPARK_ALIAS="Spark-X2.5-4B-Q6_K"
SPARK_REPO="sizzlebop/Spark-X2.5-4B-GGUF"; SPARK_FILE="Spark-X2.5-4B-Q6_K.gguf"
VT_REPO="constructai/VibeThinker-3B-GGUF"; VT_FILE="VibeThinker-3B-GGUF-Q8_0.gguf"

OUT="$SCRIPT_DIR/plan-assist-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$OUT"
LOG="$OUT/run.log"
log() { echo "[$(date +%H:%M:%S)] $*" | tee -a "$LOG"; date +%s > "$OUT/heartbeat"; }

LOCK="$SCRIPT_DIR/.bench-lock"
if ! mkdir "$LOCK" 2>/dev/null; then
  # A hard kill (SIGKILL) skips the EXIT trap and leaves the lock behind. Decide
  # whether it is live by asking whether the recorded PID still exists, instead
  # of refusing forever on a corpse.
  stale_pid=$(sed -n 's/^pid: //p' "$LOCK/info" 2>/dev/null | head -1)
  if [ -n "$stale_pid" ] && kill -0 "$stale_pid" 2>/dev/null; then
    echo "FATAL: $LOCK held by LIVE pid $stale_pid:"; cat "$LOCK/info"; exit 1
  fi
  echo "WARN: clearing STALE lock (pid '${stale_pid:-unknown}' is gone):"; cat "$LOCK/info" 2>/dev/null
  rm -rf "$LOCK"; mkdir "$LOCK" || { echo "FATAL: cannot create $LOCK"; exit 1; }
fi
{ echo "pid: $$"; echo "started: $(date)"; echo "out: $OUT"; } > "$LOCK/info"

SERVER_PID=""
kill_server() {
  [ -n "$SERVER_PID" ] && kill -9 "$SERVER_PID" 2>/dev/null
  # Kill by PID only. Killing by IMAGENAME is the documented 2026-09-11 accident.
  for p in $(tasklist //FI "IMAGENAME eq llama-server.exe" //FO CSV //NH 2>/dev/null | awk -F'","' '{print $2}'); do
    taskkill //F //PID "$p" >/dev/null 2>&1 || true
  done
  SERVER_PID=""; sleep 3
}
cleanup() { kill_server; rm -rf "$LOCK"; }
trap cleanup EXIT INT TERM

CUR_MODEL=""; CUR_ARGS=""
start_server() { # repo file alias ctx [extra...]
  local repo="$1" file="$2" alias="$3" ctx="$4"; shift 4
  CUR_MODEL="$alias"; CUR_ARGS="$(printf '%q %q %q %q' "$repo" "$file" "$alias" "$ctx") $*"
  kill_server
  log "  starting $alias (ctx=$ctx) $*"
  "$LLAMA_SERVER" -hf "$repo" -hff "$file" --alias "$alias" \
      --jinja -c "$ctx" -ngl 999 --parallel 1 \
      -ctk q8_0 -ctv q8_0 \
      --api-key "$API_KEY" --host "$HOST" --port "$PORT" \
      "$@" > "$OUT/server-$alias.log" 2>&1 &
  SERVER_PID=$!
  local i st
  for i in $(seq 1 450); do
    st=$(curl -s "http://127.0.0.1:$PORT/health" | jq -r '.status // empty' 2>/dev/null)
    [ "$st" = "ok" ] && { log "    ready in $((i*2))s"; return 0; }
    kill -0 "$SERVER_PID" 2>/dev/null || { log "    SERVER DIED"; tail -20 "$OUT/server-$alias.log" | tee -a "$LOG"; return 1; }
    sleep 2
  done
  log "    TIMEOUT waiting for $alias"; return 1
}

APPEND_SYSTEM="You are being benchmarked. Work only inside the current working directory. \
Use relative paths for all file operations and commands (e.g. write server.py, run node todos.ts). Never use absolute paths. \
Python code must use only the Python standard library. Package installation is disabled: npm, npx and pip install will be refused. \
\
TypeScript runs directly with 'node file.ts' (Node 24 strips types; it does not type-check). Follow these rules or it will not run: \
imports of your own files MUST include the .ts extension (import { f } from './util.ts'); \
use ESM only — export/import, never require() or module.exports; \
do not use enums, namespaces, or constructor parameter properties; \
there is no test framework — do not use describe/it/expect; use 'node:assert' and console.log. \
\
The file is an ES module, so require, module, exports, __filename and __dirname DO NOT EXIST. \
To run a self-test when the file is executed directly, use exactly this: \
import { pathToFileURL } from 'node:url'; \
if (import.meta.url === pathToFileURL(process.argv[1]).href) { /* self-test here */ } \
Or simply run the self-test unconditionally at the end of the file — that is acceptable and simpler. \
Import assert as a DEFAULT import: import assert from 'node:assert'; \
Your module is also IMPORTED by a separate file, not only run directly, and the exported function is what is checked. \
Running the file is therefore not enough to prove it works: a file can run and still fail to import. \
Satisfy yourself that both work before you finish. \
(there is no named 'assert' export, so import { assert } from 'node:assert' is a SyntaxError). \
\
Always verify your work by running it (as each task instructs) before finishing. \
Only print a success string such as 'all tests passed' AFTER the assertions have actually executed and passed; \
never print it unconditionally, and remember that code inside setTimeout has not run yet when the surrounding function returns. \
If you started a server or background process to verify, stop it before you finish. \
When the task is done, stop; do not start unrelated work."

# The task, verbatim from prompts-filter.txt T1.
TASK=$(awk 'BEGIN{RS="===PROMPT==="} NR==1{print}' "$SCRIPT_DIR/prompts-filter.txt")

run_agent() { # ws prompt_text timeout
  local ws="$1" ptext="$2" tmo="$3"
  mkdir -p "$ws/.pi"
  cat > "$ws/.pi/settings.json" <<EOF
{ "compaction": { "enabled": true, "reserveTokens": $(( CTX * 3 / 8 )), "keepRecentTokens": $(( CTX / 4 )) } }
EOF
  printf '%s' "$ptext" > "$ws/prompt.txt"
  local cname="pa-$(echo "$ws" | tr -cd 'A-Za-z0-9' | tail -c 30)-$$"
  local t0=$(date +%s)
  (
    cd "$ws"
    MSYS_NO_PATHCONV=1 timeout -k 15 -s TERM "$tmo" docker run --rm --name "$cname" \
      -v "$(cygpath -w "$ws"):/workspace" -w /workspace \
      -v "$EXT_WIN:/opt/bench/provider-extension.ts:ro" \
      -v "$GUARD_WIN:/opt/bench/bench-guard.ts:ro" \
      -e LLAMA_BASE_URL="http://host.docker.internal:$PORT/v1" \
      -e BENCH_CTX="$CTX" -e BENCH_MODEL="$SPARK_ALIAS" \
      "$PI_IMAGE" \
      pi --mode json --no-session --no-context-files --no-extensions --no-skills \
         --no-prompt-templates --no-themes \
         -e /opt/bench/provider-extension.ts -e /opt/bench/bench-guard.ts \
         --provider bench-local --model "bench-local/$SPARK_ALIAS" \
         --append-system-prompt "$APPEND_SYSTEM" \
         -a -- @prompt.txt \
      < /dev/null
  ) > "$ws/transcript.jsonl" 2> "$ws/stderr.log"
  local rc=$?
  docker rm -f "$cname" >/dev/null 2>&1 || true
  local t1=$(date +%s)
  { echo "exit_code: $rc"; echo "duration_sec: $((t1-t0))"; echo "context: $CTX"
    echo "run_budget_sec: $tmo"
    echo "tool_calls: $(grep -c 'tool_execution_start' "$ws/transcript.jsonl" 2>/dev/null || true)"
    echo "guard_blocks: $(grep -c 'Blocked:' "$ws/transcript.jsonl" 2>/dev/null || true)"
    echo "files_created:"
    find "$ws" -maxdepth 1 -type f ! -name 'prompt.txt' ! -name 'transcript.jsonl' ! -name 'stderr.log' -printf '  %f (%s bytes)\n'
  } > "$ws/meta.txt"
  log "    exit=$rc  $((t1-t0))s"
  return 0
}

# ---------- PLAN_ASK: identical for both planners ----------
PLAN_ASK="Produce a short numbered PLAN for another engineer who will make the fix. \
Enumerate EVERY separate defect you can find, and for each state concretely what to change. \
Then list the specific behaviors their self-test must assert. Do NOT write the corrected code."

server_healthy() {
  [ "$(curl -s --max-time 30 "http://127.0.0.1:$PORT/health" | jq -r '.status // empty' 2>/dev/null)" = "ok" ]
}

ask_plan() { # alias outfile temp topk findings maxtok
  local alias="$1" outf="$2" tmp="$3" tk="$4" findings="$5" maxtok="$6"
  # Never ask a dead server: that is what turned selfplan r2 into 0 chars.
  if ! server_healthy; then
    log "    !! server unhealthy before plan; restarting $CUR_MODEL"
    eval "start_server $CUR_ARGS" || { log "    !! restart FAILED"; return 1; }
  fi
  jq -n --arg t "$TASK" --arg a "$PLAN_ASK" --arg f "$findings" --arg m "$alias" \
        --argjson tp "$tmp" --argjson tk "$tk" --argjson mt "$maxtok" \
    '{model:$m, temperature:$tp, top_p:0.95, top_k:$tk, max_tokens:$mt,
      messages:[{role:"user",content:($t+"\n\nAn engineer investigated this module and reported:\n\n"+$f+"\n\n"+$a)}]}' \
    > "$outf.req.json"
  curl -s --max-time 3000 -H "Authorization: Bearer $API_KEY" -H 'Content-Type: application/json' \
    -d @"$outf.req.json" "http://127.0.0.1:$PORT/v1/chat/completions" > "$outf.resp.json"
  # Take the text after </think> if a reasoning block is present; else whole content.
  jq -r '.choices[0].message.content // ""' "$outf.resp.json" > "$outf.raw.txt"
  if grep -q '</think>' "$outf.raw.txt"; then
    awk 'f{print} /<\/think>/{f=1}' "$outf.raw.txt" > "$outf"
  else
    cp "$outf.raw.txt" "$outf"
  fi
  local fin; fin=$(jq -r '.choices[0].finish_reason // "?"' "$outf.resp.json")
  local ct;  ct=$(jq -r '.usage.completion_tokens // 0' "$outf.resp.json")
  log "    plan -> $(wc -c < "$outf") chars (finish=$fin tokens=$ct)"
  [ -s "$outf" ]
}

log "=== plan-assist: $REPEATS repeats x {vtplan, selfplan} on filter T1 (debounce) ==="
log "out=$OUT"

# ================= PHASE 1+2a: Spark explores, then self-plans =================
start_server "$SPARK_REPO" "$SPARK_FILE" "$SPARK_ALIAS" "$CTX" \
  --reasoning-budget 4096 --temp 0.7 --top-p 0.95 --top-k 40 || exit 1

# ORDER MATTERS HERE. The 2026-09-15 07:05 run asked for empirical verification
# FIRST and findings.md second; all three cells burned the whole budget
# experimenting and wrote no file at all, which voided the experiment. Demand the
# artifact first, then improve it, so a timeout still leaves something usable.
EXPLORE_ASK="Do NOT fix anything yet and do NOT write debounce.ts. Your ONLY deliverable is findings.md. \
STEP 1, DO THIS FIRST: read the module above and immediately write findings.md listing every distinct \
defect you can see, one per numbered section, with the exact line that is wrong. Write this file BEFORE \
running anything -- an incomplete findings.md is far better than none. \
STEP 2: only after findings.md exists on disk, reproduce the behaviour in a scratch file (any name except \
debounce.ts), run it with node, and then UPDATE findings.md to mark each defect as CONFIRMED or CORRECTED, \
adding the evidence. Re-write findings.md after each thing you learn. Never delete it. \
Do not write a corrected debounce.ts."

for r in $(seq 1 "$REPEATS"); do
  log "PHASE 1 explore rep $r"
  ws="$OUT/explore-r$r"
  run_agent "$ws" "$TASK"$'\n\n'"$EXPLORE_ASK" "$EXPLORE_TIMEOUT"
  if [ ! -s "$ws/findings.md" ]; then
    log "    !! no findings.md — retrying explore r$r ONCE"
    rm -rf "$ws"; ws="$OUT/explore-r$r"
    run_agent "$ws" "$TASK"$'\n\n'"$EXPLORE_ASK" "$EXPLORE_TIMEOUT"
  fi
  if [ -s "$ws/findings.md" ]; then
    cp "$ws/findings.md" "$OUT/findings-r$r.md"
    log "    findings-r$r.md: $(wc -c < "$OUT/findings-r$r.md") chars"
  else
    # Do NOT fall through with empty findings: that is what let the 07:05 run
    # keep going for an hour after the experiment was already void.
    log "    !! FATAL for rep $r: no findings after 2 attempts — skipping this repeat entirely"
    echo "rep $r abandoned: explore produced no findings.md in 2 attempts" >> "$OUT/ABANDONED.txt"
  fi
done

for r in $(seq 1 "$REPEATS"); do
  [ -s "$OUT/findings-r$r.md" ] || { log "PHASE 2a SKIP rep $r (abandoned)"; continue; }
  log "PHASE 2a selfplan rep $r"
  ask_plan "$SPARK_ALIAS" "$OUT/plan-selfplan-r$r.md" 0.7 40 "$(cat "$OUT/findings-r$r.md")" 6000 \
    || log "    !! selfplan r$r EMPTY"
done

# ================= PHASE 2b: VibeThinker plans =================
# Official VibeThinker-3B card: temperature 1.0, top_p 0.95, top_k -1, and a
# very large token budget (card says max_new_tokens 102400; the probe used ~5k).
start_server "$VT_REPO" "$VT_FILE" "VibeThinker-plan" "$VT_CTX" \
  --reasoning-budget -1 --temp 1.0 --top-p 0.95 --top-k 0 || exit 1

for r in $(seq 1 "$REPEATS"); do
  [ -s "$OUT/findings-r$r.md" ] || { log "PHASE 2b SKIP rep $r (abandoned)"; continue; }
  log "PHASE 2b vtplan rep $r"
  ask_plan "VibeThinker-plan" "$OUT/plan-vtplan-r$r.md" 1.0 0 "$(cat "$OUT/findings-r$r.md")" $(( VT_CTX - 2000 )) \
    || log "    !! vtplan r$r EMPTY"
done

# ================= PHASE 3: Spark executes both arms =================
start_server "$SPARK_REPO" "$SPARK_FILE" "$SPARK_ALIAS" "$CTX" \
  --reasoning-budget 4096 --temp 0.7 --top-p 0.95 --top-k 40 || exit 1

for r in $(seq 1 "$REPEATS"); do
  for arm in vtplan selfplan; do
    plan="$OUT/plan-$arm-r$r.md"
    [ -s "$plan" ] || { log "PHASE 3 SKIP $arm r$r (no plan)"; continue; }
    log "PHASE 3 execute $arm rep $r"
    # Workspace name is what grade-run.sh parses: <task>-r<rep>-<alias>.
    ws="$OUT/01-r$r-Spark-$arm"
    ptext="$TASK"$'\n\n'"## Investigation findings"$'\n\n'"$(cat "$OUT/findings-r$r.md")"$'\n\n'"## Plan to follow"$'\n\n'"$(cat "$plan")"$'\n\n'"Follow the plan above. Implement the fix, write debounce.ts, and verify with: node debounce.ts"
    run_agent "$ws" "$ptext" "$RUN_TIMEOUT"
  done
done

kill_server
log "=== running grader ==="
./grade-run.sh "$OUT" >> "$LOG" 2>&1 || log "grader returned nonzero"
log "=== DONE. Results: $OUT ==="
