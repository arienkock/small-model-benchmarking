#!/usr/bin/env bash
#
# run-filter-bench.sh — FILTER ROUND: many models, 3 tasks each.
#
# Purpose: cheaply eliminate models that obviously cannot do agentic coding, so
# the full 12-task suite is only spent on survivors.
#
# Roster:   models.conf (edit that file to add/remove models — no code change)
# Tasks:    prompts-filter.txt — tasks 5, 7 and 4 of the full suite:
#             T5  debounce bugfix   — pure TypeScript, no HTTP at all, so it is
#                                     immune to environment problems. Widest
#                                     score spread of the whole suite (1.0 vs 8.0).
#             T7  rate limiter      — Python server + TS module + stateful
#                                     sliding window + real curl verification.
#                                     The "can it actually build something" task.
#             T4  books bugfix      — Python HTTP server with a seeded header
#                                     bug. Replaced T12 (average speed) after
#                                     round 4; see below.
#
#           T5 and T7 were picked as the most discriminating in run
#           20260911-143308 and still are. T12 was picked the same way and has
#           since saturated against the current roster: its avgSpeed component
#           scored 3/4, 4/4, 4/4 in round 4, and the rest of the task was a
#           second HTTP server duplicating T7's. Note the original selection was
#           made on a 0-10 RUBRIC over two models (LFM2.5 and MiniCPM5) that
#           have both since been cut, so it was never validated against the
#           models now being compared.
#
#           T4 replaces it for a specific reason. Its seeded bug is a missing
#           Content-Length: the unmodified server returns 200 with valid JSON,
#           so `curl` alone shows a working server and only inspecting the
#           response headers finds the defect. Round 4 measured verification
#           coverage — whether a model executes the thing it is graded on — as
#           the sharpest axis in the benchmark (62% pass when it did, 14% when
#           it did not), but could only see it in the transcript. T4 puts that
#           axis in the grade. It is also the suite's only Python bugfix, and
#           round 4's worst cells across every model were Python server bugs
#           (self.full_path, parse_qs returning lists, self.connection.headers)
#           which until now appeared only as self-inflicted damage inside a
#           build task, confounded with the build.
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
# Roster and task list are selectable so a smoke test and a shortlist round can
# reuse this script unchanged. Defaults are the full filter round.
PROMPTS_FILE="${BENCH_PROMPTS:-$SCRIPT_DIR/prompts-filter.txt}"
MODELS_FILE="${BENCH_MODELS:-$SCRIPT_DIR/models.conf}"

PORT=8123
HOST=0.0.0.0                # 0.0.0.0: containers reach the server via
                            # host.docker.internal; loopback is NOT reachable
API_KEY="sk-bench"
THINK_BUDGET=4096           # server-side --reasoning-budget, equal for all models
CTX_CANDIDATES=(16384 12288 8192 4096)  # probe order, PER MODEL, highest wins
# The FIRST start of each model may include a multi-GB download, not just a
# load, so this ceiling has to cover fetching the weights. Subsequent starts
# hit the llama.cpp cache and take seconds.
SERVER_START_TIMEOUT=1800   # seconds to wait for download + model load + /health
# PER-RUN BUDGET. Filter round 1 used a flat 900s wall clock for every model,
# which is not an equal budget: decode speed across the roster spanned
# 8 tok/s (Nanbeige) to 27 tok/s (MiniCPM5), so a fixed 900s handed MiniCPM5
# ~3.4x the thinking Nanbeige got. Nanbeige still won, and its task-2 run was
# cut off ONE message after a successful 429 verification. Spark burned ~340s
# per turn at 12 tok/s and got 3-5 tool calls total.
#
# So budget TOKENS, not seconds: every model gets the same number of generated
# tokens, converted to a wall-clock cap using its own measured decode speed and
# clamped so one pathologically slow model cannot eat the night.
#
# 2026-09-12 (round 2 post-mortem, measured directly with llama-cli):
#   * The rate this used to feed the formula was the EMPTY-CONTEXT rate, and
#     every model is slower once the window fills: LFM2.5 -7%, MiniCPM5 -21%,
#     Nanbeige -31%, Granite -34% at ~8k of context. The budget was therefore
#     computed from a speed the model only reaches on its first turn.
#   * The formula also allowed ZERO time for prefill, tool execution, docker and
#     agent overhead, which is 45-65% of a real run. Net effect: the wall clock
#     for Granite, Spark and Nanbeige was 8-26% SHORTER than the time needed to
#     decode TOKEN_BUDGET tokens, before a single tool call. Those three models
#     took 6 of the 8 timeouts; the two with headroom took 1 and 0.
# So: measure at depth, then multiply by OVERHEAD_FACTOR so the token budget is
# actually reachable and the wall clock only catches degenerate loops.
# 20000 was never the binding constraint on a run that was actually working:
# across rounds 1-2 every run that finished on its own spent 3.9k-13k tokens,
# and only degenerate loops approached 20k. Repeats multiply the run count by 3,
# so spend the saving there instead — 12000 barely touches real work and nearly
# halves every wall-clock cap.
TOKEN_BUDGET="${BENCH_TOKEN_BUDGET:-12000}"
OVERHEAD_FACTOR="${BENCH_OVERHEAD:-1.9}"   # wall clock = decode time x this.
                            # Was 2.5, justified by "decode is 35-55% of a real
                            # run". Round 3's own server logs disprove that:
                            # summing every prompt-eval and eval line, the GPU is
                            # busy for 85-99% of wall clock (Granite 96%, Spark
                            # 99%), so tool execution, docker and agent overhead
                            # together are 1-7%, not 45-65%. The 2.5x was not
                            # buying overhead headroom, it was silently funding
                            # 1.1-1.4x more tokens than TOKEN_BUDGET claims:
                            # models generated 13.7k-16.6k against a nominal
                            # 12000. That reasoning set this to 1.35.
                            #
                            # 2026-09-14 (round 4, bench-filter-20260913-141131):
                            # 1.35 is too low, measured END TO END rather than
                            # inferred from server logs. Per cell, wall clock
                            # divided by (output_tokens / measured depth rate):
                            #   Granite  median 1.75x  (min 1.16 max 1.92)
                            #   Nanbeige median 1.57x  (min 1.06 max 2.47)
                            #   Spark    median 1.52x  (min 1.04 max 2.39)
                            # 19 of 36 cells hit the wall clock, and they finished
                            # on ~8.5k-10k generated tokens, not the nominal
                            # 12000. The GPU-busy figure is not wrong; it simply
                            # does not bound this ratio, because DECODE_ONLY
                            # prices only TOKEN_BUDGET decode tokens while the
                            # real run also prefills a window that grows every
                            # turn (and re-prefills it after each compaction).
                            # The overhead is worst in exactly the cells that
                            # time out: many short tool calls, each paying a full
                            # prefill. 1.9x covers the observed median with slack
                            # and still leaves the wall clock able to catch a
                            # degenerate loop.
RUN_TIMEOUT_MIN="${BENCH_MIN_RUN_SEC:-900}"   # never give less than round 1 gave;
                            # overridable so a smoke test can use a short cap
RUN_TIMEOUT_MAX="${BENCH_MAX_RUN_SEC:-3600}"  # hard ceiling per run (60 min).
                            # Was 2100, which was below Nanbeige's own decode
                            # time for the token budget — it could never spend it.
                            # 3600 clears every model except Nanbeige, which is
                            # flagged in CAVEATS.txt when it hits the ceiling.
RUN_TIMEOUT=$RUN_TIMEOUT_MIN  # per-run cap; recomputed per model from measured tok/s


# REPEATS. Rounds 1 and 2 ran n=1 per (model, task) with no temperature and no
# seed set anywhere, so every cell was a single draw from llama-server's default
# stochastic sampler. The two rounds inverted each other: 9 of 25 components
# flipped pass/fail, Nanbeige went 4/5 -> 1/5 and Granite 0/5 -> 2/5. A single
# draw per cell cannot support a shortlist decision, so repeat every cell and
# report the spread.
REPEATS="${BENCH_REPEATS:-3}"

# SAMPLING. Previously unset at every layer — not in this script, not in the pi
# settings, not in provider-extension.ts — so llama-server's built-in defaults
# applied and were never recorded. Set them explicitly and identically for every
# model, and stamp them into the summary.
#
# No --seed on purpose. A fixed seed does NOT make an agentic run reproducible:
# the conversation branches on tool output, which depends on container timing,
# port state and wall-clock. Pinning the seed would buy a false sense of
# determinism and cost a server restart per repeat. The repeats here are
# deliberately independent draws — measuring the spread IS the point.
TEMPERATURE="${BENCH_TEMP:-0.7}"
TOP_P="${BENCH_TOP_P:-0.95}"
TOP_K="${BENCH_TOP_K:-40}"
# llama-server downloads models itself via -hf/-hff, into $LLAMA_CACHE
# (default ~/.cache/llama.cpp). Nothing here needs to know about the HF cache
# layout. Set HF_TOKEN in the environment for gated repos.
EXPECTED_PROMPTS=3

CHECK_ONLY=0
[[ "${1:-}" == "--check-models" ]] && CHECK_ONLY=1
# A model that fails the turn-boundary or tool-call probe cannot produce a
# gradable transcript; by default it is skipped with a diagnosis instead of
# burning ~45 minutes. Set BENCH_FORCE_ALL=1 to run it anyway.
FORCE_ALL="${BENCH_FORCE_ALL:-0}"

# --------------------------------------------------------------- helpers ---
log()  { echo "[bench] $*"; }
die()  { echo "ERROR: $*" >&2; exit 1; }

# Match-count helpers. `grep -c` prints "0" and exits 1 when nothing matches,
# so `$(grep -c ... || echo 0)` produces the two-line string "0\n0". These
# always yield a single integer, including when the file does not exist.
count()   { local n; n="$(grep -c    "$1" "$2" 2>/dev/null || true)"; echo "${n:-0}"; }

# DEADLINE. Set BENCH_DEADLINE to a `date -d`-parsable time (e.g. "tomorrow 07:00"
# or "2026-09-14 07:00") and no cell will be started that cannot finish before it.
# Unset = no guard, the old behaviour.
DEADLINE_EPOCH=""
if [[ -n "${BENCH_DEADLINE:-}" ]]; then
    DEADLINE_EPOCH="$(date -d "$BENCH_DEADLINE" +%s 2>/dev/null || true)"
    [[ -n "$DEADLINE_EPOCH" ]] || die "BENCH_DEADLINE='$BENCH_DEADLINE' is not a parsable date"
    (( DEADLINE_EPOCH > $(date +%s) )) || die "BENCH_DEADLINE='$BENCH_DEADLINE' is in the past"
fi
count_i() { local n; n="$(grep -ciE  "$1" "$2" 2>/dev/null || true)"; echo "${n:-0}"; }

# ---------------------------------------------------- transcript signals ---
# Round 1's signals were grepped over the WHOLE transcript, which counts every
# event type. One guard block appears in tool_execution_end AND message_start
# AND message_end AND turn_end AND the agent_end history replay, so LFM2.5's
# "5/4/5 blocks" were really 1/1/1. signal_node_invocations was inflated the
# same way (MiniCPM5 task 2: reported 104 node runs out of 33 total tool calls
# -- impossible; the true figure is 15) and, because the pattern also required
# `node` to follow the opening quote, it UNDER-counted elsewhere (MiniCPM5
# task 3 reported 0 while node really ran 5 times). And PASS matched the phrase
# anywhere at all, including the prompt text echoed back, which is how Apertus
# scored PASS=6 with zero tool calls and zero files.
#
# Count from the specific event that actually represents the thing:
#   commands  -> tool_execution_start, toolName=="bash", .args.command
#   output    -> tool_execution_end, .result.content[].text
#   blocks    -> tool_execution_end with isError, text containing "Blocked:"
jq_cmds()   { jq -r 'select(.type=="tool_execution_start" and .toolName=="bash") | .args.command // empty' "$1" 2>/dev/null; }
jq_output() { jq -r 'select(.type=="tool_execution_end") | .result.content[]?.text // empty' "$1" 2>/dev/null; }
jq_errors() { jq -r 'select(.type=="tool_execution_end" and .isError==true) | .result.content[]?.text // empty' "$1" 2>/dev/null; }

# count_matches <ERE> <producer-fn> <file>
count_matches() { local n; n="$("$2" "$3" | grep -cE "$1" 2>/dev/null || true)"; echo "${n:-0}"; }

# --------------------------------------------------------- model roster ----
# Parsed before anything else so --check-models needs no server or docker.
[[ -f "$MODELS_FILE" ]] || die "models file missing: $MODELS_FILE"

ALIASES=(); REPOS=(); GLOBS=(); SRVARGS=()  # GLOBS holds exact filenames (-hff)
while IFS= read -r LINE || [[ -n "$LINE" ]]; do
    LINE="${LINE%$'\r'}"
    [[ -z "${LINE// }" ]] && continue
    [[ "$LINE" == \#* ]] && continue
    IFS='|' read -r A R G _NOTES SARGS <<< "$LINE"
    [[ -n "$A" && -n "$R" && -n "$G" ]] || die "malformed models.conf line: $LINE"
    # repo field "local" => field 3 is a path on this machine, loaded with -m
    # instead of downloaded. Use it for GGUFs you already have, so llama.cpp
    # does not re-download them into its own cache.
    #
    # The path may contain globs (HF cache paths have a revision hash in them,
    # e.g. .../snapshots/*/model.gguf). Expand it here and keep the first real
    # file, following symlinks — in the HF cache the snapshot entry is a
    # symlink into blobs/, so test with -e/-r rather than a size check.
    if [[ "$R" == "local" ]]; then
        local_expanded=""
        for cand in $G; do
            if [[ -e "$cand" && -r "$cand" ]]; then local_expanded="$cand"; break; fi
        done
        [[ -n "$local_expanded" ]] \
            || die "models.conf: no readable file matches local path for $A: $G"
        G="$local_expanded"
    fi
    ALIASES+=("$A"); REPOS+=("$R"); GLOBS+=("$G"); SRVARGS+=("${SARGS:-}")
done < "$MODELS_FILE"

(( ${#ALIASES[@]} > 0 )) || die "no models enabled in $MODELS_FILE"

# Verify a repo/file pair exists on the Hub WITHOUT downloading it, so a typo
# aborts in seconds rather than part-way through the night. llama-server does
# the actual fetching later via -hf/-hff.
verify_hf() {
    local repo="$1" file="$2" json
    json="$(curl -sf --max-time 30 "https://huggingface.co/api/models/$repo" 2>/dev/null)" || {
        printf 'ERR\trepo not found or unreachable: https://huggingface.co/%s\n' "$repo"; return 1; }
    if ! jq -e --arg f "$file" '[.siblings[]?.rfilename] | index($f)' >/dev/null 2>&1 <<< "$json"; then
        local near
        near="$(jq -r '[.siblings[]?.rfilename | select(endswith(".gguf"))] | .[0:6] | join(", ")' <<< "$json" 2>/dev/null)"
        printf 'ERR\tfile "%s" not in repo. Some .gguf files there: %s\n' "$file" "${near:-<none>}"
        return 1
    fi
    printf 'OK\t%s\n' "$file"
}

log "Verifying ${#ALIASES[@]} models against the Hugging Face API ..."
RESOLVE_FAILED=0
for i in "${!ALIASES[@]}"; do
    if [[ "${REPOS[$i]}" == "local" ]]; then
        printf '  PASS  %-32s local file (%s)\n' "${ALIASES[$i]}" "${GLOBS[$i]}"
        continue
    fi
    RESULT="$(verify_hf "${REPOS[$i]}" "${GLOBS[$i]}")"
    if [[ "${RESULT%%$'\t'*}" == "OK" ]]; then
        printf '  PASS  %-32s %s\n' "${ALIASES[$i]}" "${GLOBS[$i]}"
    else
        RESOLVE_FAILED=1
        printf '  FAIL  %-32s %s\n' "${ALIASES[$i]}" "${RESULT#*$'\t'}"
        printf '        repo=%s\n' "${REPOS[$i]}"
    fi
done

if (( RESOLVE_FAILED )); then
    echo
    die "one or more models could not be verified (see FAIL lines above). Nothing was run."
fi
log "All ${#ALIASES[@]} models exist on the Hub."

if (( CHECK_ONLY )); then
    log "--check-models: roster is good (existence only; weights download on first use)."
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

# --------------------------------------------------------------- probes ---
# Filter round 1 spent ~45 minutes per model on two models that never made a
# single tool call in nine runs, for reasons that were visible in the first
# five seconds:
#
#   Apertus     "special_eos_id is not in special_eog_ids": the turn never
#               ends, so the model role-plays BOTH sides of the conversation
#               in raw <|im_start|> text until it hits the token cap.
#   VibeThinker its template exposes no tool-call channel, so it invents one
#               (<script type="text/json">{"name":...}</script>) that pi
#               cannot parse. Every tool call is silently dropped.
#
# Both are template/tokenizer misconfigurations, NOT model ability, and both
# are detectable with one cheap request each. Probe first; do not spend hours
# collecting transcripts that cannot be graded.

# Does generation actually stop at a turn boundary, and does the model keep
# control tokens out of its visible text?
probe_turn_boundary() {
    local body
    body="$(curl -s --max-time 120 "http://127.0.0.1:$PORT/v1/chat/completions" \
        -H "Authorization: Bearer $API_KEY" -H "Content-Type: application/json" \
        -d '{"messages":[{"role":"user","content":"Reply with exactly: OK"}],"max_tokens":256}')"
    local finish content
    finish="$(jq -r '.choices[0].finish_reason // "none"' <<< "$body" 2>/dev/null)"
    content="$(jq -r '.choices[0].message.content // ""' <<< "$body" 2>/dev/null)"
    if [[ "$finish" == "length" ]]; then
        echo "FAIL|generation never reached a stop token (finish_reason=length on a 3-word reply); EOS is probably not in the model's EOG set"
        return 1
    fi
    if grep -qE '<\|im_start\|>|<\|im_end\|>|<\|endoftext\|>|<start_of_turn>|<\|assistant\|>' <<< "$content"; then
        echo "FAIL|chat control tokens leaked into visible text: $(head -c 60 <<< "$content" | tr '\n' ' ')"
        return 1
    fi
    echo "OK|finish_reason=$finish"
    return 0
}

# Does the model emit a REAL tool call through the OpenAI tool_calls channel?
probe_tool_calls() {
    local body
    body="$(curl -s --max-time 180 "http://127.0.0.1:$PORT/v1/chat/completions" \
        -H "Authorization: Bearer $API_KEY" -H "Content-Type: application/json" \
        -d '{"messages":[{"role":"user","content":"Create a file named hello.txt containing the word hi. Use the write_file tool."}],
             "tools":[{"type":"function","function":{"name":"write_file","description":"Write a file to disk",
               "parameters":{"type":"object","properties":{"path":{"type":"string"},"content":{"type":"string"}},"required":["path","content"]}}}],
             "tool_choice":"auto","max_tokens":1024}')"
    local n name content
    n="$(jq -r '(.choices[0].message.tool_calls // []) | length' <<< "$body" 2>/dev/null)"
    if [[ "$n" =~ ^[0-9]+$ ]] && (( n > 0 )); then
        name="$(jq -r '.choices[0].message.tool_calls[0].function.name // "?"' <<< "$body")"
        echo "OK|emitted $n tool_call(s), first=$name"
        return 0
    fi
    content="$(jq -r '.choices[0].message.content // ""' <<< "$body" 2>/dev/null)"
    # Distinguish "tried and could not be parsed" from "did not try at all" —
    # the former is a template problem worth fixing, the latter may be the model.
    if grep -qiE '"?name"?\s*[:=]|write_file|<tool|<function|<script' <<< "$content"; then
        echo "FAIL|model tried to call a tool in an unparseable format (no tool_calls field). Sample: $(head -c 120 <<< "$content" | tr '\n' ' ')"
    else
        echo "FAIL|model returned prose and no tool_calls field at all. Sample: $(head -c 120 <<< "$content" | tr '\n' ' ')"
    fi
    return 1
}

# Measured decode speed, from the last timing line llama-server logged.
# Used to size the per-run budget so slow models are not simply starved.
# Decode speed, measured DIRECTLY against the running server at a realistic
# context depth.
#
# The old implementation grepped the server log for `eval time = ...`. Two bugs:
#   1. "prompt eval time" CONTAINS the substring "eval time", so prefill lines
#      matched too. Prefill runs at 160-330 tok/s against decode's 7-28, so the
#      sample set was contaminated with numbers an order of magnitude too high.
#      It only ever returned a sane figure because `sort -n | head -1` (minimum
#      of the last three) happened to discard the prefill lines. A heuristic
#      that works by accident is one bad log line away from silently breaking.
#   2. It measured whatever the preflight probes happened to generate, i.e. an
#      almost-empty context. Every model is 7-34% slower at depth.
#
# Now: POST a prompt of ~DEPTH_TOKENS to /completion with ignore_eos, and read
# llama-server's own timings back. No log parsing, no prefill contamination,
# and the number describes the regime the benchmark actually runs in.
DEPTH_TOKENS=8000           # target prompt size for the speed probe, in words
DEPTH_PREDICT=128           # tokens to generate while timing

# measure_tok_s <alias> <ctx>
#
# The prompt and the request body are passed through FILES, never argv: an
# 8000-word filler is ~55 KB and `jq -n --arg` dies with "Argument list too
# long" on the Git Bash host. --rawfile and `curl -d @file` have no such limit.
#
# Depth is capped at a quarter of the model's real context. A model that only
# loads at 4096 (Apertus) would otherwise be probed with a prompt longer than
# its window, which errors instead of measuring.
measure_tok_s() {
    local alias="$1" ctx="${2:-16384}" resp v
    local depth=$(( ctx / 4 )); (( depth > DEPTH_TOKENS )) && depth=$DEPTH_TOKENS
    local pf="$OUT/.probe-prompt.txt" bf="$OUT/.probe-body.json"
    awk -v n="$depth" 'BEGIN{
        split("lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua enim",w," ")
        for(i=0;i<n;i++) printf "%s ", w[(i%20)+1]
    }' > "$pf"
    jq -n --rawfile p "$pf" --argjson n "$DEPTH_PREDICT" \
        '{prompt:$p, n_predict:$n, ignore_eos:true, cache_prompt:false, temperature:0}' > "$bf"
    # PROBE_TIMEOUT. Round 3: this was a flat `-m 300`. Nanbeige prefills at
    # ~15 tok/s at depth, so its ~7400-token probe needed ~475s and the curl was
    # cut off every time. measure_tok_s returned empty, the caller took the floor
    # branch, and the model ran all 9 cells on 900s against peers' 1188-2369s —
    # it generated 3722 tokens/cell against their 13.7k-16.6k. The single slowest
    # model is exactly the one that most needs a measured budget, and a fixed
    # timeout guarantees it is the one that cannot get one.
    # Allow for the worst prefill rate we have ever measured on this card (the
    # ~12 tok/s Nanbeige shows past its VRAM cliff) plus the decode, plus slack.
    local budget=$(( depth / 8 + DEPTH_PREDICT * 10 + 120 ))
    (( budget < 300 )) && budget=300
    resp="$(curl -s -m "$budget" -H "Authorization: Bearer $API_KEY" -H 'Content-Type: application/json' \
            -d "@$bf" "http://127.0.0.1:$PORT/completion" 2>/dev/null)"
    rm -f "$pf" "$bf"
    v="$(jq -r '.timings.predicted_per_second // empty' <<<"$resp" 2>/dev/null)"
    # Round to 2dp so it reads like the old value; empty on any failure so the
    # caller falls back to the floor rather than dividing by nothing.
    [[ -n "$v" ]] && awk -v x="$v" 'BEGIN{printf "%.2f", x}' || echo ""
}

# Start server at a given context size; verify health + smoke test.
# The first call per model also downloads the weights.
# Set by try_start on success: the context the server ACTUALLY serves, which
# is not always the one we asked for. llama-server caps -c at the model's
# training context ("the slot context (16384) exceeds the training context of
# the model (4096) - capping"). In filter round 1 Apertus was recorded as
# context 16384 while every slot was really 4096, so BENCH_CTX lied to pi:
# maxTokens became 8192 in a 4096 window and all three prompts came back
# `truncated = 1`. Always read it back from /props and believe that number.
ACTUAL_CTX=0

try_start() {
    local repo="$1" file="$2" alias="$3" ctx="$4" extra="${5:-}"
    ACTUAL_CTX=0
    kill_server
    # Either load a file already on this machine, or let llama-server fetch it:
    # -hf downloads on first use and caches in $LLAMA_CACHE, and -hff pins the
    # exact filename so the quant can never be guessed wrong.
    local -a SRC_ARGS
    if [[ "$repo" == "local" ]]; then
        SRC_ARGS=(-m "$(cygpath -w "$file" 2>/dev/null || echo "$file")")
    else
        SRC_ARGS=(-hf "$repo" -hff "$file")
    fi
    # Per-model extra flags from models.conf field 5 (word-split on purpose:
    # they are CLI flags, e.g. --override-kv ... or --chat-template-file ...).
    local -a EXTRA_ARGS=()
    [[ -n "$extra" ]] && read -r -a EXTRA_ARGS <<< "$extra"
    # A reasoning budget as large as the whole window leaves no room for the
    # prompt or the answer. Cap it at a quarter of the context.
    local think=$(( ctx / 4 )); (( think > THINK_BUDGET )) && think=$THINK_BUDGET
    # Sampler defaults are set HERE, server-side, so they apply to every request
    # the agent makes and are identical for every model. Rounds 1-2 left these
    # unset at every layer, so the run was stochastic in a way nothing recorded.
    "$LLAMA_SERVER" \
        "${SRC_ARGS[@]}" \
        --alias "$alias" \
        --jinja \
        -c "$ctx" \
        -ngl 999 \
        --parallel 1 \
        --reasoning-budget "$think" \
        --temp "$TEMPERATURE" \
        --top-p "$TOP_P" \
        --top-k "$TOP_K" \
        ${EXTRA_ARGS[@]+"${EXTRA_ARGS[@]}"} \
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
    # Believe the server, not the request.
    ACTUAL_CTX="$(curl -s -H "Authorization: Bearer $API_KEY" \
        "http://127.0.0.1:$PORT/props" \
        | jq -r '.default_generation_settings.n_ctx // empty' 2>/dev/null)"
    [[ "$ACTUAL_CTX" =~ ^[0-9]+$ ]] || ACTUAL_CTX="$ctx"
    if (( ACTUAL_CTX != ctx )); then
        log "  NOTE: asked for context $ctx, server actually serves $ACTUAL_CTX (capped to the model's training context)"
    fi
    log "  context $ACTUAL_CTX OK for $alias (smoke reply: $(echo "$reply" | head -c 40))"
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
# The guard exists to catch a prompts file mangled by a bad edit, not to pin the
# count: a smoke run legitimately uses one task. Require at least one, and warn
# when the count differs from the full filter round so a truncated file is still
# obvious in the log.
(( ${#PROMPTS[@]} >= 1 )) || die "No prompts parsed from $PROMPTS_FILE"
(( ${#PROMPTS[@]} == EXPECTED_PROMPTS )) \
    || log "NOTE: ${#PROMPTS[@]} prompts, not the usual $EXPECTED_PROMPTS ($PROMPTS_FILE)"

TOTAL_RUNS=$(( ${#ALIASES[@]} * ${#PROMPTS[@]} * REPEATS ))
log "Plan: ${#ALIASES[@]} models x ${#PROMPTS[@]} tasks x $REPEATS repeats = $TOTAL_RUNS runs"
log "Sampling: temp=$TEMPERATURE top_p=$TOP_P top_k=$TOP_K, seed unset (repeats are independent draws)"
log "Per-run budget: $TOKEN_BUDGET generated tokens x ${OVERHEAD_FACTOR} overhead, clamped to [${RUN_TIMEOUT_MIN}s, ${RUN_TIMEOUT_MAX}s]"
log "Worst case: $(( TOTAL_RUNS * RUN_TIMEOUT_MAX / 3600 ))h $(( (TOTAL_RUNS * RUN_TIMEOUT_MAX % 3600) / 60 ))m (every run at the ceiling)"
log "Typical:    $(( TOTAL_RUNS * RUN_TIMEOUT_MIN / 3600 ))h $(( (TOTAL_RUNS * RUN_TIMEOUT_MIN % 3600) / 60 ))m (every run at the floor)"
log "Round 2 averaged ~1013s/run with half the runs hitting their cap; at that"
log "rate this plan is about $(( TOTAL_RUNS * 1200 / 3600 ))h. Lower BENCH_REPEATS or BENCH_TOKEN_BUDGET to shorten it."
if (( REPEATS < 2 )); then
    log "!! REPEATS=$REPEATS. Rounds 1 and 2 ran n=1 and inverted each other's ranking."
    log "!! A single draw per cell cannot support a shortlist. Set BENCH_REPEATS=3 or more."
fi

# ------------------------------------------------------------------ runs ---
# Levelled system prompt. Identical for every model. The Node/ESM rules and the
# background-server pattern are environment facts, not task hints: without them
# both incumbents burned most of their budget on the same three ESM errors and
# on foreground-server hangs, which masked the coding ability being measured.
#
# 2026-09-12 (filter round 1 post-mortem): NONE of the 5 models that produced a
# debounce.ts could actually run it. Every failure was an ESM/Node-24 idiom, not
# a debugging failure -- the one model that fixed all three seeded bugs (Granite)
# scored BELOW models that fixed two, purely because `process.main === module`
# throws in ESM. Observed, each of these killed at least one deliverable:
#   require.main === module        -> ReferenceError: require is not defined
#   process.main === module        -> ReferenceError: module is not defined
#   __filename                     -> ReferenceError: __filename is not defined
#   process.argv[0] === <script>   -> silently false; self-test never runs
#   import { assert } from 'node:assert'  -> SyntaxError, no such named export
# The exact main-detection snippet and the correct assert import are therefore
# spelled out below. They are environment facts about how this harness executes
# TypeScript, identical for every model, and they advantage none of them.
#
# 2026-09-14 (round 4 post-mortem): stating them was not enough. Granite broke
# one of these rules in 8 of its 12 .ts deliverables, 6 fatally, two rounds
# after they were written down for its benefit. They are now ALSO enforced by
# bench-guard.ts at write time, which is the instrument that actually works
# here: 13 of 13 guard blocks across every round were followed by a different
# action, and no model has ever retried a blocked one. The prompt keeps stating
# them so a model can get it right without being corrected, and the block
# catches it when it does not. Blocks are counted per cell in meta.txt
# (signal_guard_blocks), so needing six corrections stays visible.
#
# The import line below closes a gap the harness created. Granite's 01-r1
# debounce shipped `if (import.meta.main || process.argv[1] === __filename)`.
# Run directly, import.meta.main short-circuits the || and the file prints
# "all tests passed"; imported, it evaluates __filename and throws. The model
# verified exactly as the prompt told it to, and the prescribed check is blind
# to the defect the grader tests for. Verified by reproduction. Telling models
# the module is imported as well as run is a statement of fact about the
# harness, like the rest of this block -- not a hint about any task.
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
To verify a server, start it in the background with output captured, then read the log if something fails: \
python3 server.py > server.log 2>&1 & \
then note the pid from \$!, curl the endpoints, and kill that pid when done. \
If a curl against your server fails, read server.log BEFORE changing any code — the traceback is in there. \
If you get 'Address already in use', set allow_reuse_address = True on your HTTPServer subclass. \
In http.server, self.path INCLUDES the query string, so self.path == '/api/x' is false for '/api/x?a=1'; \
split it with urllib.parse.urlparse(self.path).path before comparing. \
HTTPServer takes an (host, port) TUPLE, not a 'host:port' string. \
Every bash command is limited to 120 seconds, so never run a server in the foreground. \
\
Always verify your work by running it (as each task instructs) before finishing. \
Only print a success string such as 'all tests passed' AFTER the assertions have actually executed and passed; \
never print it unconditionally, and remember that code inside setTimeout has not run yet when the surrounding function returns. \
If you started a server or background process to verify, stop it before you finish. \
When the task is done, stop; do not start unrelated work."

run_one() {
    local alias="$1" num="$2" prompt="$3" ctx="$4" rep="${5:-1}"
    # Workspace name carries the repeat: 01-r2-Granite-4.2-3B-Q8_0.
    # grade-run.sh parses <task>-r<rep>-<model> and aggregates across repeats.
    local ws="$OUT/$(printf '%02d' "$num")-r${rep}-$alias"
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

    log "  task $num/${#PROMPTS[@]} rep $rep — $alias"
    local t0=$(date +%s)
    local cname="bench-$(printf '%02d' "$num")r${rep}-$(echo "$alias" | tr -cd 'A-Za-z0-9')-$$"

    # MSYS_NO_PATHCONV stops Git Bash mangling container-side absolute paths.
    # The workspace is the ONLY writable host path; extensions are read-only.
    # stdin /dev/null gives pi instant EOF (it blocks on piped stdin otherwise).
    (
        cd "$ws"
        # -k 15 -s TERM: ask the agent to stop and give it 15s to flush its
        # last events before SIGKILL. Round 1 hard-killed at the cap and several
        # transcripts end mid-token; Nanbeige task 2 died one message after a
        # successful 429 verification. This does not add a real "wrap up" turn
        # (pi is invoked one-shot with -a -- @prompt.txt, so there is no way to
        # inject another user message); it only guarantees a clean tail.
        MSYS_NO_PATHCONV=1 timeout -k 15 -s TERM "$RUN_TIMEOUT" docker run --rm --name "$cname" \
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
    local node_ok node_run curl_run blocked t="$ws/transcript.jsonl"
    node_run=$(count_matches '(^|[;&|[:space:]])node ' jq_cmds   "$t")
    curl_run=$(count_matches '(^|[;&|[:space:]])curl ' jq_cmds   "$t")
    blocked=$( count_matches 'Blocked:'                jq_errors "$t")
    # Only count a pass string that a COMMAND actually printed, never one the
    # model wrote in prose or echoed from the prompt.
    node_ok=$(  count_matches 'all tests passed'       jq_output "$t")

    {
        echo "run: $num"
        echo "repeat: $rep"
        echo "model: $alias"
        echo "workspace: $ws"
        echo "exit_code: $rc"
        echo "duration_sec: $((t1 - t0))"
        echo "context: $ctx"
        echo "reasoning_budget: ${THINK_EFF:-$THINK_BUDGET}"
        echo "run_budget_sec: $RUN_TIMEOUT"
        echo "decode_tok_s: ${MODEL_TOKS[$alias]:-?}"
        echo "sampling: temp=$TEMPERATURE top_p=$TOP_P top_k=$TOP_K seed=unset"
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

declare -A MODEL_CTX MODEL_TOKS MODEL_BUDGET
RUN_INDEX=0

for i in "${!ALIASES[@]}"; do
    ALIAS="${ALIASES[$i]}"
    REPO="${REPOS[$i]}"
    FILE="${GLOBS[$i]}"

    log "=== $ALIAS ($((i+1))/${#ALIASES[@]}) ==="

    # Per-model context probe: highest candidate THIS model actually loads.
    log "  probing context (${CTX_CANDIDATES[*]}) — first start also downloads the weights"
    MODEL_CTX[$ALIAS]=0
    for CTX in "${CTX_CANDIDATES[@]}"; do
        if try_start "$REPO" "$FILE" "$ALIAS" "$CTX" "${SRVARGS[$i]}"; then
            # ACTUAL_CTX, not CTX: the server caps -c at the training context.
            # If it did cap, restart at the real size. --reasoning-budget was
            # derived from the value we ASKED for, so leaving it would hand
            # Apertus a 4096-token budget inside a 4096-token window -- the very
            # thing this is meant to prevent.
            if (( ACTUAL_CTX < CTX )); then
                log "  restarting $ALIAS at its real context $ACTUAL_CTX so the reasoning budget matches"
                try_start "$REPO" "$FILE" "$ALIAS" "$ACTUAL_CTX" "${SRVARGS[$i]}" \
                    || { log "  !! $ALIAS failed to restart at $ACTUAL_CTX"; MODEL_CTX[$ALIAS]=0; break; }
            fi
            MODEL_CTX[$ALIAS]=$ACTUAL_CTX
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
    THINK_EFF=$(( CTX / 4 )); (( THINK_EFF > THINK_BUDGET )) && THINK_EFF=$THINK_BUDGET
    log "  context $CTX, reasoning budget $THINK_EFF"

    curl -s -H "Authorization: Bearer $API_KEY" "http://127.0.0.1:$PORT/props" \
        | jq '{n_ctx: .default_generation_settings.n_ctx, n_ctx_train: (.default_generation_settings.n_ctx_train // null)}' \
        > "$OUT/server-$ALIAS-props.json"

    # ---- preflight probes: is this model gradable at all? ----------------
    TB="$(probe_turn_boundary)"; TB_OK=$?
    TC="$(probe_tool_calls)";    TC_OK=$?
    printf '%-32s turn_boundary=%s\n%-32s tool_calls=%s\n' \
        "$ALIAS" "$TB" "$ALIAS" "$TC" >> "$OUT/PREFLIGHT.txt"
    log "  probe turn_boundary: $TB"
    log "  probe tool_calls:    $TC"
    if (( TB_OK != 0 || TC_OK != 0 )) && [[ "$FORCE_ALL" != "1" ]]; then
        log "  !! $ALIAS fails a preflight probe — SKIPPING (set BENCH_FORCE_ALL=1 to run anyway)"
        {
            echo "$ALIAS: preflight failure — transcripts would not be gradable"
            echo "    turn_boundary: $TB"
            echo "    tool_calls:    $TC"
        } >> "$OUT/SKIPPED.txt"
        kill_server
        continue
    fi

    # ---- per-model wall-clock budget from decode speed measured AT DEPTH ---
    # wall clock = (tokens / depth rate) * OVERHEAD_FACTOR. The multiplier is
    # what round 2 lacked: decode is only 35-55% of a real run, so a budget
    # equal to pure decode time cannot be spent, and the cap fires while the
    # model is still working rather than only when it loops.
    TOKS="$(measure_tok_s "$ALIAS" "$CTX")"
    if [[ -n "$TOKS" ]]; then
        RUN_TIMEOUT=$(awk -v b="$TOKEN_BUDGET" -v t="$TOKS" -v f="$OVERHEAD_FACTOR" \
                          -v lo="$RUN_TIMEOUT_MIN" -v hi="$RUN_TIMEOUT_MAX" \
            'BEGIN{ s=(t>0)? (b/t)*f : lo; if(s<lo)s=lo; if(s>hi)s=hi; printf "%d", s }')
        DECODE_ONLY=$(awk -v b="$TOKEN_BUDGET" -v t="$TOKS" 'BEGIN{printf "%d", (t>0)? b/t : 0}')
        log "  decode ~${TOKS} tok/s at $(( CTX/4 > DEPTH_TOKENS ? DEPTH_TOKENS : CTX/4 ))-word context depth"
        log "  -> ${DECODE_ONLY}s to decode $TOKEN_BUDGET tokens, x${OVERHEAD_FACTOR} overhead = ${RUN_TIMEOUT}s per run"
        if (( RUN_TIMEOUT >= RUN_TIMEOUT_MAX )); then
            log "  !! budget hit the ${RUN_TIMEOUT_MAX}s ceiling — this model cannot spend its token budget"
            echo "$ALIAS: wall-clock ceiling ${RUN_TIMEOUT_MAX}s < needed $(awk -v d="$DECODE_ONLY" -v f="$OVERHEAD_FACTOR" 'BEGIN{printf "%d", d*f}')s; results are wall-clock bound" \
                >> "$OUT/CAVEATS.txt"
        fi
    else
        RUN_TIMEOUT=$RUN_TIMEOUT_MIN
        log "  !! decode speed UNKNOWN -> per-run budget ${RUN_TIMEOUT}s (floor, NOT measured)"
        # Round 3 took this branch silently for Nanbeige and nothing in the run
        # said so; the caveat had to be reconstructed by hand afterwards. A model
        # on an unmeasured budget is not comparable to one on a measured budget,
        # and the artifact must say that itself.
        {
            echo "$ALIAS: per-run budget fell to the ${RUN_TIMEOUT_MIN}s FLOOR — the speed probe returned nothing."
            echo "    This budget is NOT measured and NOT comparable to the other models' budgets."
            echo "    Do not read this model's timeouts as slowness or looping; check whether the agent"
            echo "    was still making progress at cutoff, and re-run with a forced budget before cutting it."
        } >> "$OUT/CAVEATS.txt"
    fi
    MODEL_TOKS[$ALIAS]="${TOKS:-?}"
    MODEL_BUDGET[$ALIAS]=$RUN_TIMEOUT

    for REP in $(seq 1 "$REPEATS"); do
        NUM=0
        for PROMPT in "${PROMPTS[@]}"; do
            ((NUM+=1)); ((RUN_INDEX+=1))
            # DEADLINE GUARD. An overnight run has a hard hand-back time, and a
            # cell that cannot finish before it is worse than no cell: it burns
            # the clock and produces a torn transcript. Refuse to START a cell
            # whose own budget would cross the deadline, and reserve the floor
            # budget for every cell still owed to the models after this one so a
            # slow early model cannot starve a later one. Skipped cells are
            # recorded, so the analysis sees unequal n instead of silent gaps.
            if [[ -n "$DEADLINE_EPOCH" ]]; then
                cells_left_other=$(( (${#ALIASES[@]} - i - 1) * ${#PROMPTS[@]} * REPEATS ))
                reserve=$(( cells_left_other * RUN_TIMEOUT_MIN ))
                need=$(( $(date +%s) + RUN_TIMEOUT + reserve ))
                if (( need > DEADLINE_EPOCH )); then
                    log "    SKIPPED by deadline guard (needs ${RUN_TIMEOUT}s + ${reserve}s reserved for later models)"
                    echo "$ALIAS task $NUM repeat $REP: skipped, deadline guard" >> "$OUT/SKIPPED-DEADLINE.txt"
                    continue
                fi
            fi
            log "[$RUN_INDEX/$TOTAL_RUNS] repeat $REP/$REPEATS"
            run_one "$ALIAS" "$NUM" "$PROMPT" "$CTX" "$REP"
        done
    done

    log "=== finished $ALIAS ==="
done

kill_server

# ---------------------------------------------------------------- summary --
{
    echo "# Filter-round summary — $(date)"
    echo "tasks: 3 (full-suite 5, 7, 12)  reasoning_budget: <=$THINK_BUDGET (capped at ctx/4)"
    echo "repeats: $REPEATS independent runs per (model, task)"
    echo "sampling: temp=$TEMPERATURE top_p=$TOP_P top_k=$TOP_K, seed unset"
    echo "budget: $TOKEN_BUDGET generated tokens x ${OVERHEAD_FACTOR} overhead, clamped to [${RUN_TIMEOUT_MIN}s, ${RUN_TIMEOUT_MAX}s]"
    echo "decode speed: measured per model at ${DEPTH_TOKENS}-word context depth, not on an empty window"
    echo "sandbox: docker ($PI_IMAGE), guard extension active (URL-safe)"
    echo "context: probed PER MODEL (highest of ${CTX_CANDIDATES[*]})"
    echo "host: $(uname -s) node $(node --version 2>/dev/null) python $(python3 --version 2>&1 | awk '{print $2}')"
    echo
    for a in "${ALIASES[@]}"; do
        c="${MODEL_CTX[$a]:-0}"
        if [[ "$c" == "0" ]]; then
            echo "$a: DID-NOT-LOAD (skipped)"
        elif [[ -z "${MODEL_BUDGET[$a]:-}" ]]; then
            echo "$a: context $c  SKIPPED by preflight probe (see PREFLIGHT.txt)"
        else
            echo "$a: context $c  decode ${MODEL_TOKS[$a]:-?} tok/s @depth  budget ${MODEL_BUDGET[$a]}s"
        fi
    done
    echo
    for f in "$OUT"/[0-9][0-9]-r*/meta.txt; do
        [[ -e "$f" ]] || continue
        grep -E '^(run|model|exit_code|duration_sec):' "$f" | tr '\n' ' '
        echo
    done
} > "$OUT/SUMMARY.txt"

# Triage table: one row per run, the cheap signals side by side. Sort by model
# to eyeball which models produced nothing and can be dropped immediately.
{
    printf '%-32s %4s %4s %5s %8s %6s %6s %6s %6s %6s\n' \
        MODEL TASK REP EXIT DURATION TOOLS NODE CURL PASS BLOCK
    # header stays put; only the body is sorted
    {
        for f in "$OUT"/[0-9][0-9]-r*/meta.txt; do
            [[ -e "$f" ]] || continue
            get() { grep -E "^$1:" "$f" | head -1 | sed "s/^$1: *//"; }
            printf '%-32s %4s %4s %5s %8s %6s %6s %6s %6s %6s\n' \
                "$(get model)" "$(get run)" "$(get repeat)" "$(get exit_code)" "$(get duration_sec)" \
                "$(get tool_calls)" "$(get signal_node_invocations)" \
                "$(get signal_curl_invocations)" "$(get signal_tests_passed_strings)" \
                "$(get signal_guard_blocks)"
        done
    } | sort -k1,1 -k2,2n -k3,3n
    echo
    echo "EXIT 0=finished on its own  124=hit this model's wall-clock budget (see SUMMARY.txt)"
    echo "NODE/CURL = bash commands invoking them, counted from tool_execution_start"
    echo "PASS = 'all tests passed' printed by a COMMAND (tool output only, never model prose)"
    echo "BLOCK = distinct guard refusals, counted from tool_execution_end errors"
    echo
    echo "These are triage signals, NOT grades, and round 1 proved they cannot be"
    echo "used as grades: a model can print a pass string without running a test."
    echo "The grades are in GRADES.txt, produced by executing every deliverable."
} > "$OUT/FILTER-REPORT.txt"

# ------------------------------------------------------------- grading ----
# Execute every deliverable and record what actually works. This is the grade;
# FILTER-REPORT.txt above is only triage. Never let a run finish without it --
# round 1's string-matched signals ranked the field backwards.
if [[ -x "$SCRIPT_DIR/grade-run.sh" ]]; then
    log "Grading deliverables by executing them ..."
    "$SCRIPT_DIR/grade-run.sh" "$OUT" >/dev/null 2>&1 \
        && log "  wrote $OUT/GRADES.txt" \
        || log "  !! grading failed (are ports 8000/8080/8888/3000 free?); run ./grade-run.sh '$OUT' by hand"
else
    log "grade-run.sh not found or not executable — skipping objective grading"
fi

cat "$OUT/SUMMARY.txt"
echo
cat "$OUT/FILTER-REPORT.txt"
[[ -f "$OUT/PREFLIGHT.txt" ]] && { echo; echo "--- preflight probes ---"; cat "$OUT/PREFLIGHT.txt"; }
[[ -f "$OUT/GRADES.txt"    ]] && { echo; cat "$OUT/GRADES.txt"; }
log "Done. Results: $OUT"
