#!/usr/bin/env bash
#
# run-filter-bench.sh — FILTER ROUND: many models, 3 tasks each.
#
# Purpose: cheaply eliminate models that obviously cannot do agentic coding, so
# the full 12-task suite is only spent on survivors.
#
# Roster:   models.conf (edit that file to add/remove models — no code change)
# Tasks:    prompts-filter.txt — tasks 5, 7 and 12 of the full suite, chosen as
#           the three most discriminating in run 20260911-143308:
#             T5  debounce bugfix   — pure TypeScript, no HTTP at all, so it is
#                                     immune to environment problems. Widest
#                                     score spread of the whole suite (1.0 vs 8.0).
#             T7  rate limiter      — Python server + TS module + stateful
#                                     sliding window + real curl verification.
#                                     The "can it actually build something" task.
#             T12 average speed     — simplest full build, plus an embedded
#                                     prompt-injection attempt to resist.
#
# Budget:   7 models x 3 tasks x 15 min cap = 5.25 h worst case, ~2-3 h typical.
#
# ===========================================================================
# WHAT CHANGED vs run-coding-bench.sh (see bench-findings-143308.md)
#
#  1. URL MANGLING FIXED (bench-guard.ts). The old guard's Windows-path regex
#     matched the "p://" in "http://" and rewrote every URL-bearing command to
#     "htt.". Nearly every HTTP verification in run 143308 failed because of
#     this, for both models. This was a harness bug scored as a model failure.
#
#  2. PER-MODEL CONTEXT. The old script used the MINIMUM context across all
#     models, so one VRAM-hungry model dragged everyone down. With 3B/4B models
#     on a 6 GB card that would have pinned all seven to 8192. Each model now
#     runs at the highest context IT can load, and the value is recorded per
#     model in SUMMARY.txt and FILTER-REPORT.txt so the report can account for it.
#
#  3. TIMEOUT 1800 -> 900. In run 143308, every one of the 11 timeouts was a
#     degenerate loop or a foreground-server hang, not a nearly-finished task.
#     Longest genuine success was 1465 s; the three tasks here topped out at
#     ~850 s. 900 s keeps every observed success and halves the worst case.
#
#  4. BASH TIMEOUT CEILING (bench-guard.ts). A server started in the foreground
#     never returns and used to eat the entire per-task budget. Bash calls are
#     now clamped to [30 s, 120 s]: the model loses 2 minutes and gets a timeout
#     message it can react to.
#
#  5. prompt.txt IS READ-ONLY (bench-guard.ts). LFM2.5 overwrote the task
#     description in two separate tasks of run 143308, destroying the baseline.
#
#  6. PACKAGE INSTALLS BLOCKED (bench-guard.ts). npm/pnpm/yarn install, npx and
#     pip install now fail with an explanatory message. MiniCPM5 ran
#     `npm install typescript` and npx ts-node/tsx/esbuild, which both breaks
#     the stated rule and hides the model's real TypeScript ability.
#
#  7. LEVELLED SYSTEM PROMPT. Node 24 type-stripping rules, background-server
#     and log-reading pattern, and SO_REUSEADDR are now stated explicitly. Both
#     models lost points on every TS deliverable to the same three ESM errors —
#     a knowledge gap that masks the coding signal this benchmark measures.
#     Identical text for every model, so it advantages none of them.
#
#  8. MODEL ROSTER IS DATA (models.conf) and GGUFs are resolved + downloaded in
#     PREFLIGHT, before any run starts. A wrong repo id aborts in two minutes
#     instead of silently wasting the night.
# ===========================================================================

set -u

# ---------------------------------------------------------------- config ---
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
LLAMA_SERVER="$SCRIPT_DIR/../llama-server.exe"
PI_IMAGE="coding-bench-agent:latest"
EXTENSION="$SCRIPT_DIR/provider-extension.ts"
GUARD_EXT="$SCRIPT_DIR/bench-guard.ts"
DOCKERFILE_DIR="$SCRIPT_DIR/docker"
PROMPTS_FILE="$SCRIPT_DIR/prompts-filter.txt"
MODELS_FILE="$SCRIPT_DIR/models.conf"

PORT=8123
HOST=0.0.0.0                # 0.0.0.0: containers reach the server via
                            # host.docker.internal; loopback is NOT reachable
API_KEY="sk-bench"
THINK_BUDGET=4096           # server-side --reasoning-budget, equal for all models
CTX_CANDIDATES=(16384 12288 8192 4096)  # probe order, PER MODEL, highest wins
SERVER_START_TIMEOUT=600    # seconds to wait for model load + /health
RUN_TIMEOUT=900             # per-run wall clock limit (seconds)
# Cache roots tried in order. HF's own env vars win when set, so this follows
# the same resolution the `hf` CLI uses; the last entry is the machine default.
HF_CACHE_ROOTS=(
    ${HF_HUB_CACHE:-}
    ${HF_HOME:+$HF_HOME/hub}
    ${HF_CACHE:-}
    "/c/Users/zenfi/.cache/huggingface/hub"
    "$HOME/.cache/huggingface/hub"
)
EXPECTED_PROMPTS=3

CHECK_ONLY=0
[[ "${1:-}" == "--check-models" ]] && CHECK_ONLY=1

# --------------------------------------------------------------- helpers ---
log()  { echo "[bench] $*"; }
die()  { echo "ERROR: $*" >&2; exit 1; }

# Match-count helpers. `grep -c` prints "0" and exits 1 when nothing matches,
# so `$(grep -c ... || echo 0)` produces the two-line string "0\n0". These
# always yield a single integer, including when the file does not exist.
count()   { local n; n="$(grep -c    "$1" "$2" 2>/dev/null || true)"; echo "${n:-0}"; }
count_i() { local n; n="$(grep -ciE  "$1" "$2" 2>/dev/null || true)"; echo "${n:-0}"; }

# --------------------------------------------------------- model roster ----
# Parsed before anything else so --check-models needs no server or docker.
[[ -f "$MODELS_FILE" ]] || die "models file missing: $MODELS_FILE"

ALIASES=(); REPOS=(); GLOBS=()
while IFS= read -r LINE || [[ -n "$LINE" ]]; do
    LINE="${LINE%$'\r'}"
    [[ -z "${LINE// }" ]] && continue
    [[ "$LINE" == \#* ]] && continue
    IFS='|' read -r A R G _NOTES <<< "$LINE"
    [[ -n "$A" && -n "$R" && -n "$G" ]] || die "malformed models.conf line: $LINE"
    ALIASES+=("$A"); REPOS+=("$R"); GLOBS+=("$G")
done < "$MODELS_FILE"

(( ${#ALIASES[@]} > 0 )) || die "no models enabled in $MODELS_FILE"

# Which CLI can fetch models, if any.
HF_BIN=""
command -v hf              >/dev/null 2>&1 && HF_BIN="hf"
[[ -z "$HF_BIN" ]] && command -v huggingface-cli >/dev/null 2>&1 && HF_BIN="huggingface-cli"

# Search every plausible cache root for one repo's GGUF.
#
# NOTE: in the HF cache, snapshots/<rev>/<file>.gguf is a SYMLINK into
# blobs/<sha>. `find -name X -size +100M` therefore matches NOTHING, because
# -size measures the link (a few bytes), not its target. `-L` makes find follow
# symlinks, so -type f both resolves the real file and skips broken links
# (a pointer left by an interrupted download).
find_cached() {
    local repo="$1" pattern="$2" root dir hit
    for root in "${HF_CACHE_ROOTS[@]}"; do
        [[ -n "$root" && -d "$root" ]] || continue
        dir="$root/models--${repo//\//--}"
        [[ -d "$dir" ]] || continue
        hit="$(find -L "$dir" -type f -name "$pattern" 2>/dev/null | head -1)"
        [[ -n "$hit" ]] && { echo "$hit"; return 0; }
    done
    return 1
}

# Resolve one model's GGUF: cache hit, else download.
#
# Prints exactly one line:  "OK<TAB><path>"  or  "ERR<TAB><reason>"
# It is always called in a command substitution, i.e. a SUBSHELL, so a status
# variable set in here would not survive the return — the reason has to travel
# out on stdout with the result.
resolve_gguf() {
    local repo="$1" pattern="$2" found

    if found="$(find_cached "$repo" "$pattern")"; then
        printf 'OK\t%s\n' "$found"; return 0
    fi

    # Distinguish "never downloaded" from "downloaded but incomplete": a repo
    # directory with no resolvable file means broken symlinks left by an
    # interrupted fetch, which needs a re-download, not a corrected repo id.
    local why="not in any cache root"
    local root
    for root in "${HF_CACHE_ROOTS[@]}"; do
        [[ -n "$root" && -d "$root/models--${repo//\//--}" ]] || continue
        why="repo IS cached but no readable file matches '$pattern' (incomplete download, or wrong filename)"
        break
    done

    if [[ -z "$HF_BIN" ]]; then
        printf 'ERR\t%s; and neither '"'"'hf'"'"' nor '"'"'huggingface-cli'"'"' is installed to fetch it\n' "$why"
        return 1
    fi

    # Download, keeping the output so a failure can be explained.
    local dl_log; dl_log="$(mktemp 2>/dev/null || echo "/tmp/hf-dl-$$.log")"
    if ! "$HF_BIN" download "$repo" --include "$pattern" > "$dl_log" 2>&1; then
        printf 'ERR\tdownload failed: %s\n' "$(tr '\n' ' ' < "$dl_log" | tail -c 200)"
        rm -f "$dl_log"; return 1
    fi
    rm -f "$dl_log"

    if found="$(find_cached "$repo" "$pattern")"; then
        printf 'OK\t%s\n' "$found"; return 0
    fi
    printf 'ERR\t%s\n' "download succeeded but no file matching '$pattern' appeared in the cache"
    return 1
}

log "Resolving ${#ALIASES[@]} models from $MODELS_FILE ..."
log "  cache roots: ${HF_CACHE_ROOTS[*]:-<none set>}"
log "  downloader:  ${HF_BIN:-<none found>}"
declare -a GGUFS
RESOLVE_FAILED=0
for i in "${!ALIASES[@]}"; do
    RESULT="$(resolve_gguf "${REPOS[$i]}" "${GLOBS[$i]}")"
    STATUS="${RESULT%%$'\t'*}"
    PAYLOAD="${RESULT#*$'\t'}"
    if [[ "$STATUS" == "OK" ]]; then
        GGUFS[$i]="$PAYLOAD"
        printf '  PASS  %-32s %s\n' "${ALIASES[$i]}" "$(basename "$PAYLOAD")"
    else
        GGUFS[$i]=""
        RESOLVE_FAILED=1
        printf '  FAIL  %-32s %s\n' "${ALIASES[$i]}" "$PAYLOAD"
        printf '        repo=%s  file=%s\n' "${REPOS[$i]}" "${GLOBS[$i]}"
        printf '        fetch manually with:  %s download %s --include "%s"\n' \
            "${HF_BIN:-hf}" "${REPOS[$i]}" "${GLOBS[$i]}"
    fi
done

if (( RESOLVE_FAILED )); then
    echo
    die "one or more models could not be resolved (see FAIL lines above). Nothing was run."
fi
log "All ${#ALIASES[@]} models resolved."

if (( CHECK_ONLY )); then
    log "--check-models: roster is good. Exiting without running the benchmark."
    exit 0
fi

# Absolute, always: used as a docker -v host path (a relative path silently
# becomes a bogus named volume and every run fails with exit 125 in ~1s).
OUT="$SCRIPT_DIR/bench-filter-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$OUT"
cp "$MODELS_FILE" "$OUT/models.conf"   # exact roster used, for the record

# Single-instance lock: two concurrent bench runs kill each other's
# llama-server (taskkill-by-port) and pi agents. Refuse to double-start.
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
trap 'rm -rf "$LOCK_DIR" 2>/dev/null' EXIT
trap 'exit 130' INT TERM

SERVER_PID=""

kill_server() {
    # Kill only OUR llama-server (by pid), then clear anything still holding
    # the port. Never kill by image name: that pattern killed both runs'
    # servers during the 2026-09-11 accident.
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
    # max_tokens must be large enough that a thinking model can finish
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

if ! docker info >/dev/null 2>&1; then
    die "docker daemon not reachable — start Docker Desktop (if it refuses: taskkill Docker Desktop.exe + com.docker.backend.exe, then 'wsl --shutdown', then relaunch)"
fi

if ! docker image inspect "$PI_IMAGE" >/dev/null 2>&1; then
    log "Building agent image $PI_IMAGE (first run only)..."
    docker build -t "$PI_IMAGE" "$DOCKERFILE_DIR" || die "failed to build $PI_IMAGE"
fi

stale_containers="$(docker ps -aq --filter 'name=^bench-' 2>/dev/null)"
if [[ -n "$stale_containers" ]]; then
    log "removing stale bench containers: $stale_containers"
    docker rm -f $stale_containers >/dev/null 2>&1 || true
fi

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
(( ${#PROMPTS[@]} == EXPECTED_PROMPTS )) \
    || die "Expected $EXPECTED_PROMPTS prompts but found ${#PROMPTS[@]}"

TOTAL_RUNS=$(( ${#ALIASES[@]} * ${#PROMPTS[@]} ))
log "Plan: ${#ALIASES[@]} models x ${#PROMPTS[@]} tasks = $TOTAL_RUNS runs"
log "Worst case: $(( TOTAL_RUNS * RUN_TIMEOUT / 3600 ))h $(( (TOTAL_RUNS * RUN_TIMEOUT % 3600) / 60 ))m"

# ------------------------------------------------------------------ runs ---
# Levelled system prompt. Identical for every model. The Node/ESM rules and the
# background-server pattern are environment facts, not task hints: without them
# both incumbents burned most of their budget on the same three ESM errors and
# on foreground-server hangs, which masked the coding ability being measured.
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
    local alias="$1" num="$2" prompt="$3" ctx="$4"
    local ws="$OUT/$(printf '%02d' "$num")-$alias"
    mkdir -p "$ws/.pi"

    # Compaction scaled to the actual context window for THIS model (pi's
    # defaults assume 100k+ and are degenerate below ~32k):
    #   reserveTokens   = 3/8 of the window -> compact at 5/8 of the window
    #   keepRecentTokens= 1/4 of the window -> keep the last quarter verbatim
    local reserve=$(( ctx * 3 / 8 ))
    local keep=$(( ctx / 4 ))
    cat > "$ws/.pi/settings.json" <<EOF
{
  "compaction": {
    "enabled": true,
    "reserveTokens": $reserve,
    "keepRecentTokens": $keep
  }
}
EOF

    printf '%s' "$prompt" > "$ws/prompt.txt"

    log "  task $num/${#PROMPTS[@]} — $alias"
    local t0=$(date +%s)
    local cname="bench-$(printf '%02d' "$num")-$(echo "$alias" | tr -cd 'A-Za-z0-9')-$$"

    # MSYS_NO_PATHCONV stops Git Bash mangling container-side absolute paths.
    # The workspace is the ONLY writable host path; extensions are read-only.
    # stdin /dev/null gives pi instant EOF (it blocks on piped stdin otherwise).
    (
        cd "$ws"
        MSYS_NO_PATHCONV=1 timeout "$RUN_TIMEOUT" docker run --rm --name "$cname" \
            -v "$(cygpath -w "$ws"):/workspace" \
            -w /workspace \
            -v "$EXT_WIN:/opt/bench/provider-extension.ts:ro" \
            -v "$GUARD_WIN:/opt/bench/bench-guard.ts:ro" \
            -e LLAMA_BASE_URL="http://host.docker.internal:$PORT/v1" \
            -e BENCH_CTX="$ctx" \
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
    # agent left inside it) must die with the run.
    docker rm -f "$cname" >/dev/null 2>&1 || true

    local t1=$(date +%s)

    # Cheap, transcript-derived filter signals. These are NOT a grade — they are
    # the "did this model do anything at all" summary that makes triage fast.
    # NOTE: `grep -c` prints 0 AND exits 1 when there is no match, so the
    # idiom `$(grep -c ... || echo 0)` yields the two-line value "0\n0" and
    # corrupts meta.txt. count() handles no-match and missing-file alike.
    local node_ok node_run curl_run blocked
    node_run=$(count '"command":"[^"]*node ' "$ws/transcript.jsonl")
    curl_run=$(count '"command":"[^"]*curl ' "$ws/transcript.jsonl")
    blocked=$(count 'Blocked:' "$ws/transcript.jsonl")
    node_ok=$(count_i 'all tests passed|passed":true' "$ws/transcript.jsonl")

    {
        echo "run: $num"
        echo "model: $alias"
        echo "workspace: $ws"
        echo "exit_code: $rc"
        echo "duration_sec: $((t1 - t0))"
        echo "context: $ctx"
        echo "reasoning_budget: $THINK_BUDGET"
        echo "files_created:"
        find "$ws" -maxdepth 1 -type f ! -name 'prompt.txt' ! -name 'transcript.jsonl' ! -name 'stderr.log' -printf '  %f (%s bytes)\n'
        echo "tool_calls: $(count tool_execution_start "$ws/transcript.jsonl")"
        echo "output_tokens_total: $(jq -s '[.[] | select(.type=="message_end") | .message.usage.output] | add // 0' "$ws/transcript.jsonl" 2>/dev/null || echo 0)"
        echo "input_tokens_total: $(jq -s '[.[] | select(.type=="message_end") | .message.usage.input] | add // 0' "$ws/transcript.jsonl" 2>/dev/null || echo 0)"
        echo "signal_node_invocations: $node_run"
        echo "signal_curl_invocations: $curl_run"
        echo "signal_tests_passed_strings: $node_ok"
        echo "signal_guard_blocks: $blocked"
    } > "$ws/meta.txt"

    if [[ $rc -eq 124 ]]; then
        log "    TIMEOUT after ${RUN_TIMEOUT}s (transcript kept for grading)"
    elif [[ $rc -eq 125 ]]; then
        cat "$ws/stderr.log" >&2
        die "docker failed to start the container (exit 125) — see stderr above"
    elif [[ $rc -ne 0 ]]; then
        log "    exit code $rc (see stderr.log)"
    else
        log "    done in $((t1 - t0))s"
    fi
}

declare -A MODEL_CTX
RUN_INDEX=0

for i in "${!ALIASES[@]}"; do
    ALIAS="${ALIASES[$i]}"
    MPATH="$(cygpath -w "${GGUFS[$i]}")"

    log "=== $ALIAS ($((i+1))/${#ALIASES[@]}) ==="

    # Per-model context probe: highest candidate THIS model actually loads.
    log "  probing context (${CTX_CANDIDATES[*]}) ..."
    MODEL_CTX[$ALIAS]=0
    for CTX in "${CTX_CANDIDATES[@]}"; do
        if try_start "$MPATH" "$ALIAS" "$CTX"; then
            MODEL_CTX[$ALIAS]=$CTX
            break
        fi
    done

    if (( ${MODEL_CTX[$ALIAS]} == 0 )); then
        # A model that cannot be served at any context is a roster problem, not
        # a model result. Record it and move on — do not sink the whole night.
        log "  !! $ALIAS could not load at ANY context size — SKIPPING its tasks"
        echo "$ALIAS: could not load at any of ${CTX_CANDIDATES[*]}" >> "$OUT/SKIPPED.txt"
        kill_server
        continue
    fi

    CTX=${MODEL_CTX[$ALIAS]}
    log "  context $CTX, reasoning budget $THINK_BUDGET"

    curl -s -H "Authorization: Bearer $API_KEY" "http://127.0.0.1:$PORT/props" \
        | jq '{n_ctx: .default_generation_settings.n_ctx, n_ctx_train: (.default_generation_settings.n_ctx_train // null)}' \
        > "$OUT/server-$ALIAS-props.json"

    NUM=0
    for PROMPT in "${PROMPTS[@]}"; do
        ((NUM+=1)); ((RUN_INDEX+=1))
        log "[$RUN_INDEX/$TOTAL_RUNS]"
        run_one "$ALIAS" "$NUM" "$PROMPT" "$CTX"
    done

    log "=== finished $ALIAS ==="
done

kill_server

# ---------------------------------------------------------------- summary --
{
    echo "# Filter-round summary — $(date)"
    echo "tasks: 3 (full-suite 5, 7, 12)  reasoning_budget: $THINK_BUDGET  run_timeout: ${RUN_TIMEOUT}s"
    echo "sandbox: docker ($PI_IMAGE), guard extension active (URL-safe)"
    echo "context: probed PER MODEL (highest of ${CTX_CANDIDATES[*]})"
    echo
    for a in "${ALIASES[@]}"; do
        c="${MODEL_CTX[$a]:-0}"
        if [[ "$c" == "0" ]]; then
            echo "$a: DID-NOT-LOAD (skipped)"
        else
            echo "$a: context $c"
        fi
    done
    echo
    for f in "$OUT"/[0-9][0-9]-*/meta.txt; do
        [[ -e "$f" ]] || continue
        grep -E '^(run|model|exit_code|duration_sec):' "$f" | tr '\n' ' '
        echo
    done
} > "$OUT/SUMMARY.txt"

# Triage table: one row per run, the cheap signals side by side. Sort by model
# to eyeball which models produced nothing and can be dropped immediately.
{
    printf '%-32s %4s %5s %8s %6s %6s %6s %6s %6s\n' \
        MODEL TASK EXIT DURATION TOOLS NODE CURL PASS BLOCK
    # header stays put; only the body is sorted
    {
        for f in "$OUT"/[0-9][0-9]-*/meta.txt; do
            [[ -e "$f" ]] || continue
            get() { grep -E "^$1:" "$f" | head -1 | sed "s/^$1: *//"; }
            printf '%-32s %4s %5s %8s %6s %6s %6s %6s %6s\n' \
                "$(get model)" "$(get run)" "$(get exit_code)" "$(get duration_sec)" \
                "$(get tool_calls)" "$(get signal_node_invocations)" \
                "$(get signal_curl_invocations)" "$(get signal_tests_passed_strings)" \
                "$(get signal_guard_blocks)"
        done
    } | sort -k1,1 -k2,2n
    echo
    echo "EXIT 0=finished on its own  124=hit the ${RUN_TIMEOUT}s cap"
    echo "NODE/CURL = bash calls invoking them   PASS = 'all tests passed'-style strings"
    echo "BLOCK = guard refusals (absolute paths, package installs, prompt.txt writes)"
    echo "These are triage signals, not grades. Grade from the transcripts."
} > "$OUT/FILTER-REPORT.txt"

cat "$OUT/SUMMARY.txt"
echo
cat "$OUT/FILTER-REPORT.txt"
log "Done. Results: $OUT"
