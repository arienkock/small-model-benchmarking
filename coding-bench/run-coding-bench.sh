#!/usr/bin/env bash
#
# run-coding-bench.sh — agent coding benchmark: LFM2.5-2.6B vs MiniCPM5-2B
#
# Drives non-interactive pi against a local llama-server, one fresh workspace
# per (model, prompt) run. Both models get EQUAL context size and EQUAL
# reasoning budget.
#
# Architecture (docker sandbox edition, see README.md):
#
#   Host (Windows):   llama-server.exe on the GPU, port 8123, bound to
#                     0.0.0.0 (containers reach the host via
#                     host.docker.internal; loopback binds are NOT reachable).
#   Container (each run): pi + node 24 + python3 from image
#                     coding-bench-agent. The ONLY host path mounted is the
#                     task workspace (at /workspace). Everything the agent
#                     does outside /workspace lands in the ephemeral container
#                     layer and dies with --rm. Container death also kills
#                     leftover verification servers (no port crossfire between
#                     tasks/runs, no orphaned pi processes).
#   Guard extension (bench-guard.ts): belt-and-braces INSIDE the container.
#                     Rewrites hallucinated absolute paths into the workspace
#                     (so correct-but-misplaced work is still graded), blocks
#                     machine-level damage, raises too-short bash timeouts.
#                     Loaded via a second -e (explicit -e paths survive
#                     --no-extensions).
#
#   Why docker instead of running pi on Windows: the 2026-09-11 runs showed
#   small models burn most of their error budget on Windows/Git-Bash
#   mismatches (ps can't see their server, ss missing, /tmp != D:\tmp,
#   pkill unreliable) and on absolute-path hallucinations that wrote
#   deliverables outside their workspaces. Linux + path guard removes both
#   classes. See bench-findings.md for the transcript analysis.
#
# Design decisions kept from the original script:
#
#   Context size: 16384 tokens, probed (16384 -> 12288 -> 8192), highest that
#     BOTH models load wins, so neither is advantaged. GTX 970M 6GB: Q8_0
#     weights ~2.9GB (LFM) / ~2.8GB (MiniCPM); KV ~20 vs ~43 KB/token.
#
#   Reasoning budget: llama-server --reasoning-budget N is the single
#     enforcement point (server-side default for every request).
#
#   pi is invoked non-interactively (--mode json); the full event stream
#     (tool calls + results + responses) is captured as JSONL for grading.
#     Each run gets its own empty workspace; the prompt is passed as @file.
#
#   Compaction: pi auto-compacts when contextTokens > contextWindow -
#     reserveTokens. pi's DEFAULTS are tuned for 100k+ contexts and are
#     degenerate at 16k. Each workspace gets a project-local .pi/settings.json
#     with scaled values (reserve 6144, keep-recent 4096), trusted via -a.

set -u

# ---------------------------------------------------------------- config ---
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# The model cache lives on D:, not C:. Single source of truth — see the file
# itself for why this must be set explicitly.
source "$SCRIPT_DIR/../llama-cache.env"

LLAMA_SERVER="$SCRIPT_DIR/../llama-server.exe"
PI_IMAGE="coding-bench-agent:latest"
EXTENSION="$SCRIPT_DIR/provider-extension.ts"
GUARD_EXT="$SCRIPT_DIR/bench-guard.ts"
DOCKERFILE_DIR="$SCRIPT_DIR/docker"
PROMPTS_FILE="$SCRIPT_DIR/prompts.txt"

PORT=8123
HOST=0.0.0.0                # 0.0.0.0: containers reach the server via
                            # host.docker.internal; loopback is NOT reachable
API_KEY="sk-bench"
THINK_BUDGET=4096           # server-side --reasoning-budget (tokens), equal for all models
CTX_CANDIDATES=(16384 12288 8192)   # probe order; highest that BOTH models load wins
SERVER_START_TIMEOUT=600    # seconds to wait for model load + /health
RUN_TIMEOUT=1800            # per-run wall clock limit (seconds)
HF_CACHE="/c/Users/zenfi/.cache/huggingface/hub"

# Absolute, always: it is used as a docker -v host path (a relative path
# silently becomes a bogus named volume → "invalid characters for a local
# volume name", and every run fails with exit 125 in ~1s).
OUT="$SCRIPT_DIR/bench-coding-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$OUT"

# --------------------------------------------------------------- helpers ---
log()  { echo "[bench] $*"; }
die()  { echo "ERROR: $*" >&2; exit 1; }

# `grep -c` prints "0" AND exits 1 when nothing matches, so the idiom
# `$(grep -c ... || echo 0)` yields the two-line string "0\n0" and corrupts
# meta.txt. Always a single integer, missing file included.
count() { local n; n="$(grep -c "$1" "$2" 2>/dev/null || true)"; echo "${n:-0}"; }

# Single-instance lock: two concurrent bench runs kill each other's
# llama-server (taskkill-by-port) and pi agents. Refuse to double-start.
# NOTE: no flock in Git Bash's MSYS — mkdir is the atomic primitive on
# Windows. Stale locks (crash / kill -9) are detected via the recorded pid.
LOCK_DIR="$SCRIPT_DIR/.bench-lock"
if [[ -d "$LOCK_DIR" ]]; then
    stale_pid="$(cat "$LOCK_DIR/pid" 2>/dev/null || true)"
    if [[ -n "$stale_pid" ]] && kill -0 "$stale_pid" 2>/dev/null; then
        die "another bench run is active (pid $stale_pid, $(cat "$LOCK_DIR/info" 2>/dev/null)); refusing to start"
    fi
    log "removing stale lock (pid ${stale_pid:-unknown} is not running)"
    rm -rf "$LOCK_DIR"
fi
mkdir "$LOCK_DIR" || die "could not acquire bench lock"
echo "$$" > "$LOCK_DIR/pid"
echo "$OUT (started $(date))" > "$LOCK_DIR/info"
# NOTE: INT/TERM must EXIT, not just clean up — a bare cleanup trap lets the
# script swallow Ctrl+C and continue into the next task (observed live: the
# container died but the bench marched on with a dead llama-server).
trap 'rm -rf "$LOCK_DIR" 2>/dev/null' EXIT
trap 'exit 130' INT TERM

SERVER_PID=""

kill_server() {
    # Kill only OUR llama-server (by pid), then clear anything still holding
    # the port (e.g. a crashed run's orphan). Never kill by image name: that
    # pattern killed both runs' servers during the 2026-09-11 accident.
    if [[ -n "$SERVER_PID" ]]; then
        kill -9 "$SERVER_PID" 2>/dev/null || true
        wait "$SERVER_PID" 2>/dev/null || true
        SERVER_PID=""
    fi
    local pid
    pid=$(netstat -ano | awk -v p=":$PORT" '$1 ~ /TCP$/ && $2 ~ p"$" && /LISTENING/ {print $NF}' | sort -u | head -1)
    if [[ -n "$pid" ]]; then
        log "  clearing process holding port $PORT (pid $pid)"
        taskkill //F //PID "$pid" >/dev/null 2>&1 || true
    fi
    sleep 1
}

wait_health() {
    local deadline=$(( $(date +%s) + SERVER_START_TIMEOUT ))
    while (( $(date +%s) < deadline )); do
        # /health returns 200 only once the model is fully loaded
        if curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/health" | grep -q '^200$'; then
            return 0
        fi
        sleep 5
    done
    return 1
}

chat_smoke_test() {
    # NOTE: max_tokens must be large enough that a thinking model can finish
    # reasoning AND emit the answer.
    curl -s "http://127.0.0.1:$PORT/v1/chat/completions" \
        -H "Authorization: Bearer $API_KEY" \
        -H "Content-Type: application/json" \
        -d '{"messages":[{"role":"user","content":"Reply with exactly: OK"}],"max_tokens":512}' \
        | jq -r '.choices[0].message.content' 2>/dev/null
}

# Start server at a given context size; verify health + smoke test.
try_start() {
    local model_winpath="$1" alias="$2" ctx="$3"
    kill_server
    "$LLAMA_SERVER" \
        -m "$model_winpath" \
        --alias "$alias" \
        --jinja \
        -c "$ctx" \
        -ngl 999 \
        --reasoning-budget "$THINK_BUDGET" \
        --api-key "$API_KEY" \
        --host "$HOST" --port "$PORT" \
        > "$OUT/server-$alias.log" 2>&1 &
    SERVER_PID=$!
    if ! wait_health; then
        log "  context $ctx FAILED for $alias (load timeout or OOM)"
        kill_server
        return 1
    fi
    local reply
    reply="$(chat_smoke_test)"
    if [[ -z "$reply" ]]; then
        log "  context $ctx: /health OK but chat completion empty for $alias"
        kill_server
        return 1
    fi
    log "  context $ctx OK for $alias (smoke reply: $(echo "$reply" | head -c 40))"
    return 0
}

# ------------------------------------------------------------- preflight ---
[[ -x "$LLAMA_SERVER" ]] || die "llama-server.exe not found at $LLAMA_SERVER"
[[ -f "$EXTENSION" ]]    || die "provider extension missing: $EXTENSION"
[[ -f "$GUARD_EXT" ]]    || die "guard extension missing: $GUARD_EXT"
[[ -f "$PROMPTS_FILE" ]] || die "prompts file missing: $PROMPTS_FILE"
command -v curl >/dev/null || die "curl not available"
command -v jq   >/dev/null || die "jq not available"
command -v timeout >/dev/null || die "timeout (coreutils) not available"

# Docker must be up (start Docker Desktop if the daemon is down: it may need
# 'wsl --shutdown' first when it wedges after a stale stop).
if ! docker info >/dev/null 2>&1; then
    die "docker daemon not reachable — start Docker Desktop (if it refuses: taskkill Docker Desktop.exe + com.docker.backend.exe, then 'wsl --shutdown', then relaunch)"
fi

# Build the agent image on first use (cached afterwards).
if ! docker image inspect "$PI_IMAGE" >/dev/null 2>&1; then
    log "Building agent image $PI_IMAGE (first run only)..."
    docker build -t "$PI_IMAGE" "$DOCKERFILE_DIR" || die "failed to build $PI_IMAGE"
fi

# Kill containers left over from an interrupted run (they hold no host
# resources, but a stale bench-run container on the same name breaks docker).
local_stale_containers="$(docker ps -aq --filter 'name=^bench-' 2>/dev/null)"
if [[ -n "$local_stale_containers" ]]; then
    log "removing stale bench containers: $local_stale_containers"
    docker rm -f $local_stale_containers >/dev/null 2>&1 || true
fi

# Locate the Q8_0 GGUFs downloaded by the earlier llama-cli runs.
LFM_GGUF="$(find "$HF_CACHE/models--LiquidAI--LFM2.5-2.6B-GGUF" -name '*Q8_0.gguf' 2>/dev/null | head -1)"
MINI_GGUF="$(find "$HF_CACHE/models--openbmb--MiniCPM5-2B-GGUF" -name 'MiniCPM5-2B-Q8_0.gguf' 2>/dev/null | head -1)"
[[ -n "$LFM_GGUF" ]] || die "LFM2.5-2.6B-Q8_0.gguf not found in $HF_CACHE"
[[ -n "$MINI_GGUF" ]] || die "MiniCPM5-2B-Q8_0.gguf not found in $HF_CACHE"

# Windows paths for llama-server.
LFM_WIN="$(cygpath -w "$LFM_GGUF")"
MINI_WIN="$(cygpath -w "$MINI_GGUF")"

# Windows paths for the mounted extension files (read-only inside container).
EXT_WIN="$(cygpath -w "$EXTENSION")"
GUARD_WIN="$(cygpath -w "$GUARD_EXT")"

# ---------------------------------------------------------------- prompts --
PROMPTS=()
CURRENT=""
while IFS= read -r LINE || [[ -n "$LINE" ]]; do
    LINE="${LINE%$'\r'}"
    if [[ "$LINE" == "===PROMPT===" ]]; then
        PROMPTS+=("$CURRENT"); CURRENT=""
    else
        if [[ -n "$CURRENT" ]]; then CURRENT+=$'\n'; fi
        CURRENT+="$LINE"
    fi
done < "$PROMPTS_FILE"
if [[ -n "$CURRENT" ]]; then PROMPTS+=("$CURRENT"); fi

log "Found ${#PROMPTS[@]} prompts."
if [[ ${#PROMPTS[@]} -ne 12 ]]; then
    die "Expected 12 prompts but found ${#PROMPTS[@]}"
fi

# --------------------------------------------------- context size probing --
log "Probing context sizes (candidates: ${CTX_CANDIDATES[*]})..."
kill_server

declare -A SUPPORTED_CTX
for MODEL_DEF in "LFM2.5-2.6B-Q8_0|$LFM_WIN" "MiniCPM5-2B-Q8_0|$MINI_WIN"; do
    ALIAS="${MODEL_DEF%%|*}"
    MPATH="${MODEL_DEF#*|}"
    SUPPORTED_CTX[$ALIAS]=0
    for CTX in "${CTX_CANDIDATES[@]}"; do
        if try_start "$MPATH" "$ALIAS" "$CTX"; then
            SUPPORTED_CTX[$ALIAS]=$CTX
            break
        fi
    done
    (( ${SUPPORTED_CTX[$ALIAS]} > 0 )) || die "Could not load $ALIAS at any candidate context size"
done

BENCH_CTX=$(( SUPPORTED_CTX["LFM2.5-2.6B-Q8_0"] < SUPPORTED_CTX["MiniCPM5-2B-Q8_0"] \
    ? SUPPORTED_CTX["LFM2.5-2.6B-Q8_0"] : SUPPORTED_CTX["MiniCPM5-2B-Q8_0"] ))

log "Benchmark context size: $BENCH_CTX (equal for both models)"
log "Reasoning budget: $THINK_BUDGET tokens (server-side, equal for both models)"

# ------------------------------------------------------------------ runs ---
# Kept IDENTICAL to run-filter-bench.sh so the two rounds measure the same
# thing. The Node/ESM rules and the background-server pattern are environment
# facts, not task hints: without them both incumbents burned most of their
# budget on the same three ESM errors and on foreground-server hangs, which
# masked the coding ability being measured. See bench-findings-143308.md §4.
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
To verify a server, start it in the background with output captured, then read the log if something fails: \
python3 server.py > server.log 2>&1 & \
then note the pid from \$!, curl the endpoints, and kill that pid when done. \
If you get 'Address already in use', set allow_reuse_address = True on your HTTPServer subclass. \
Every bash command is limited to 120 seconds, so never run a server in the foreground. \
\
Always verify your work by running it (as each task instructs) before finishing. \
If you started a server or background process to verify, stop it before you finish. \
When the task is done, stop; do not start unrelated work."

run_one() {
    local alias="$1" num="$2" prompt="$3"
    local ws="$OUT/$(printf '%02d' "$num")-$alias"
    mkdir -p "$ws/.pi"

    # Compaction scaled to the 16k benchmark window (defaults assume 100k+):
    #   reserveTokens 6144  -> compact when context exceeds 16384 - 6144 = 10240
    #   keepRecentTokens 4096 -> keep the last ~4k of messages verbatim
    cat > "$ws/.pi/settings.json" <<EOF
{
  "compaction": {
    "enabled": true,
    "reserveTokens": 6144,
    "keepRecentTokens": 4096
  }
}
EOF

    printf '%s' "$prompt" > "$ws/prompt.txt"

    log "Run $num/12 — $alias (workspace: $ws)"
    local t0=$(date +%s)
    local cname="bench-$(printf '%02d' "$num")-$(echo "$alias" | tr -cd 'A-Za-z0-9')-$$"

    # Docker sandbox run. MSYS_NO_PATHCONV stops Git Bash from mangling the
    # container-side absolute paths (/workspace, /opt/bench). The workspace is
    # the ONLY writable host path; extensions are mounted read-only. stdin
    # /dev/null gives pi instant EOF (it would otherwise block on piped
    # stdin that never closes).
    (
        cd "$ws"
        MSYS_NO_PATHCONV=1 timeout "$RUN_TIMEOUT" docker run --rm --name "$cname" \
            -v "$(cygpath -w "$ws"):/workspace" \
            -w /workspace \
            -v "$EXT_WIN:/opt/bench/provider-extension.ts:ro" \
            -v "$GUARD_WIN:/opt/bench/bench-guard.ts:ro" \
            -e LLAMA_BASE_URL="http://host.docker.internal:$PORT/v1" \
            -e BENCH_CTX="$BENCH_CTX" \
            -e BENCH_MODEL="$alias" \
            "$PI_IMAGE" \
            pi --mode json --no-session --no-context-files --no-extensions --no-skills \
               --no-prompt-templates --no-themes \
               -e /opt/bench/provider-extension.ts -e /opt/bench/bench-guard.ts \
               --provider bench-local --model "bench-local/$alias" \
               --append-system-prompt "$APPEND_SYSTEM" \
               -a -- @prompt.txt \
            < /dev/null
    ) > "$ws/transcript.jsonl" 2> "$ws/stderr.log"
    local rc=$?

    # GNU timeout only kills the docker CLI; the container (and any server the
    # agent left inside it) must die with the run. --rm handles the normal case;
    # this covers timeouts and crashes.
    docker rm -f "$cname" >/dev/null 2>&1 || true

    local t1=$(date +%s)

    {
        echo "run: $num"
        echo "model: $alias"
        echo "workspace: $ws"
        echo "exit_code: $rc"
        echo "duration_sec: $((t1 - t0))"
        echo "context: $BENCH_CTX"
        echo "reasoning_budget: $THINK_BUDGET"
        echo "files_created:"
        find "$ws" -maxdepth 1 -type f ! -name 'prompt.txt' ! -name 'transcript.jsonl' ! -name 'stderr.log' -printf '  %f (%s bytes)\n'
        echo "tool_calls: $(count tool_execution_start "$ws/transcript.jsonl")"
        echo "output_tokens_total: $(jq -s '[.[] | select(.type=="message_end") | .message.usage.output] | add // 0' "$ws/transcript.jsonl" 2>/dev/null)"
        echo "input_tokens_total: $(jq -s '[.[] | select(.type=="message_end") | .message.usage.input] | add // 0' "$ws/transcript.jsonl" 2>/dev/null)"
    } > "$ws/meta.txt"

    if [[ $rc -eq 124 ]]; then
        log "  TIMEOUT after ${RUN_TIMEOUT}s (container killed, transcript kept for grading)"
    elif [[ $rc -eq 125 ]]; then
        # docker itself refused to run the container (bad flags/paths/daemon):
        # infrastructure failure, not a model result. Fail the whole bench
        # instead of burning through every remaining task.
        cat "$ws/stderr.log" >&2
        die "docker failed to start the container (exit 125) — see stderr above"
    elif [[ $rc -ne 0 ]]; then
        log "  exit code $rc (see stderr.log)"
    else
        log "  done in $((t1 - t0))s"
    fi
}

for MODEL_DEF in "LFM2.5-2.6B-Q8_0|$LFM_WIN" "MiniCPM5-2B-Q8_0|$MINI_WIN"; do
    ALIAS="${MODEL_DEF%%|*}"
    MPATH="${MODEL_DEF#*|}"

    log "=== Starting server for $ALIAS (context $BENCH_CTX, reasoning budget $THINK_BUDGET) ==="
    kill_server
    try_start "$MPATH" "$ALIAS" "$BENCH_CTX" || die "Failed to start $ALIAS at the common context size"

    # Record effective server-side settings for the report.
    curl -s -H "Authorization: Bearer $API_KEY" "http://127.0.0.1:$PORT/props" \
        | jq '{n_ctx: .default_generation_settings.n_ctx, n_ctx_train: (.default_generation_settings.n_ctx_train // null)}' \
        > "$OUT/server-$ALIAS-props.json"

    NUM=0
    for PROMPT in "${PROMPTS[@]}"; do
        ((NUM+=1))
        run_one "$ALIAS" "$NUM" "$PROMPT"
    done

    log "=== Finished $ALIAS ==="
done

kill_server

# ---------------------------------------------------------------- summary --
{
    echo "# Coding bench summary — $(date)"
    echo "context: $BENCH_CTX  reasoning_budget: $THINK_BUDGET  run_timeout: ${RUN_TIMEOUT}s"
    echo "sandbox: docker ($PI_IMAGE), guard extension active"
    echo
    for f in "$OUT"/[0-9][0-9]-*/meta.txt; do
        grep -E '^(run|model|exit_code|duration_sec):' "$f" | tr '\n' ' '
        echo
    done
} > "$OUT/SUMMARY.txt"

cat "$OUT/SUMMARY.txt"
log "Done. Results: $OUT"
