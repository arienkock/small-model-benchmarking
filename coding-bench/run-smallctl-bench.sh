#!/usr/bin/env bash
#
# run-smallctl-bench.sh — the SmallCTL arm of the harness comparison.
#
#   ./run-smallctl-bench.sh
#
# WHAT THIS IS
#
# run-filter-bench.sh drives the pi agent over prompts-filter.txt. This script
# drives the SmallCTL harness over the SAME prompts, with the same models, the
# same server settings and the same per-cell wall-clock budgets, and writes the
# same directory layout — so grade-run.sh grades both arms identically and the
# only variable between them is the harness.
#
# grade-run.sh globs <RUN_DIR>/[0-9][0-9]-*/ and parses <task>-r<rep>-<model>
# from the directory name, then executes whatever deliverables it finds. It
# never reads a transcript, so it does not care which harness produced the
# files. That is what makes this comparison possible at all.
#
# PARITY NOTES — each of these is a deliberate match to the pi arm:
#
#   budgets      NOT re-measured. The per-model wall-clock budgets are taken
#                verbatim from bench-filter-20260914-203559 (Granite 1424s,
#                Spark 1757s) so both arms get an identical clock. Re-measuring
#                would introduce a second difference and cost ~15 min of GPU.
#   context      24576, NOT the pi arm's 16384 -- see CONTEXT PARITY below.
#   reasoning    512 server-side, NOT the pi arm's 4096 -- see REASONING BUDGET.
#   sampling     temp 0.7 / top_p 0.95 / top_k 40, seed unset.
#   toolchain    the smallctl image carries node v24.21.0 + python3 + curl, to
#                match pi's coding-bench-agent sandbox. Two of the three tasks
#                tell the model to verify with `node <file>.ts`.
#
# CONTEXT PARITY IS DELIBERATELY BROKEN, AND THIS IS THE HEADLINE RESULT.
#
# SmallCTL CANNOT RUN THESE TASKS AT 16384, the context the pi arm used. Its
# system prompt alone measures ~7800 tokens, and with the llamacpp provider
# profile it derives its own prompt budget from the server window rather than
# from the flags given to it:
#     build_request_budget(16384) = 16384 -1024 -2048 -512      = 12800
#     soft prompt limit           = 12800 - 12800//3 - 512      =  8022
#     assembled first prompt      = system 7803 + messages 1523 =  9326
# so the very first assembly overflows and the cell dies with
# PROMPT BUDGET OVERFLOW after a single tool call. Raising
# --reserve-completion-tokens cannot help (it is clamped to limit//3), and
# cutting the tool surface from 32 tools to 21 moved the system prompt by
# 9 tokens -- the bulk is SmallCTL's own scaffolding, not tool schemas.
#
# At 24576 the same arithmetic gives 24576-1024-3072-768 = 19712, so the soft
# limit is 19712-5120-512 = 14080 and the ~9.3k prompt fits with room to spare.
#
# 24576 AND NOT MORE. 32768 also loads on this card -- and then prefills at
# 17.5 tok/s instead of ~150, because the KV cache no longer fits in the 6 GiB
# and spills. A 9.7k-token prompt would cost 9 minutes of prefill per turn,
# roughly two turns per cell. Loading is not the test; speed is. Measured
# prefill over a 12k-token prompt:
#     ctx    Granite      Spark
#     16384  148.8 tok/s  167.8 tok/s
#     20480  148.0        166.4
#     24576  147.7        167.4      <- flat, still entirely on the GPU
#     32768   17.5         (not measured -- cliff already crossed)
# The pi ladder never tried above 16384 only because CTX_CANDIDATES starts
# there, so this headroom was simply never discovered.
#
# CONSEQUENCE: this arm is NOT directly comparable to
# bench-filter-20260914-203559. It answers "can SmallCTL do these tasks with
# these models at all", not "which harness is better at equal context". For
# the latter, pi must be re-run at 32768 and compared with that.
#
# REASONING BUDGET 1024, NOT THE PI ARM'S 4096.
#
# SmallCTL sends max_tokens = min(base, limit - prompt - margins); with a ~10k
# prompt at 24576 that lands near 5120. A 4096 reasoning budget therefore lets
# the model spend almost the entire completion allowance thinking, and the
# stream ends before a tool call is emitted:
#     final_task_status: failed
#     postmortem: "Model stream halted repeatedly without a tool call or final
#                  actionable answer. Halt reason: reasoning_only_stream_stall."
# That was cell 1 at 4096 -- 639s, three dispatched tools, nothing written.
# The same stall appeared earlier at budget 2048 against a 1024 reserve, and
# disappeared at 512. A reasoning budget the harness cannot consume does not
# measure the harness; it guarantees an empty cell.
#
# 1024 IS NOT LOW ENOUGH EITHER. It carried Granite through tasks 1 and 2, but
# Spark stalled on every cell: 12 turns, 433 tokens generated, and the model
# output log classified ALL 433 as thinking tokens with not one content token.
# The 1024 budget was never even reached -- the stream ends inside the think
# block. Measured on task 1, same prompt, same everything but the budget:
#     budget 1024 -> 0 content tokens, no file, reasoning_only_stream_stall
#     budget  512 -> 460 model tokens vs 443 thinking (17 content), and
#                    debounce.ts written with 4 file_write + 8 file_read calls
# This is budget sensitivity, not incapability: Spark drives SmallCTL fine at
# 512. Lower is safer for every model here, so the whole arm runs at 512 rather
# than per-model budgets, which would make the models incomparable to each
# other.
#
# At 512 the model thinks briefly and keeps most of the allowance for the answer.
# Do NOT "fix" this with --reasoning-budget 0: that makes the model leak a raw
# </think> into visible text ("PONG</think>PONG").
#
# PARITY: the pi arm ran at 4096. This deviation is recoverable at no extra
# cost, because that arm has to be re-run at 24576 anyway for context parity --
# run it at 1024 as well and both variables are matched again.
#
# NO PRESET. --preset coding-local looks right and is a trap: it hardcodes
# max_prompt_tokens=8192, reserve_completion_tokens=1024, provider=generic and
# reasoning_mode=tags, and it BEATS the explicit CLI flags — a smoke cell with
# --preset coding-local --max-prompt-tokens 16384 still died with
#   "PROMPT BUDGET OVERFLOW: 8268 assembled, exceeds the max prompt limit of 8022"
# because the preset's 8192 was in force, not the 16384 asked for. Everything
# is therefore passed as explicit flags and no preset is used.
#
# The budget is tight even at 16384. SmallCTL's system prompt with its full
# 32-tool surface measures ~7812 tokens on its own, and it is mandatory content
# that compaction cannot shrink. With a 5120 completion reserve the soft prompt
# limit is 16384-5120-512 = 10752, leaving roughly 1k of headroom over a
# ~9.8k assembled prompt. 5120 still clears the 4096 reasoning budget with room
# for an answer. That overhead is a real property of the harness, not something
# to tune away by cutting its toolset.
#
# RUN MODE IS FORCED TO `loop`. pi is invoked as an agent (-a) with tools, so
# SmallCTL has to be in a tool-using runtime for the comparison to mean
# anything. All three candidates were probed on task 1 with the prompt budget
# already fixed, one cell each:
#     auto (the default)  -> chat runtime: gives up at 204s having made 1 tool
#                            call, writes nothing, reports chat_completed
#     planning            -> 0 tool calls
#     loop                -> 4 file_read calls and still working at the cap
# `loop` is the only one that dispatches tools at all. An earlier probe made
# loop look worse (10 turns, 0 tools) but that ran at 16384, where the very
# first prompt assembly overflowed, so nothing could ever be dispatched --
# a broken budget, not a bad run mode.
#
# SmallCTL's completion reserve MUST exceed the server's reasoning budget. With
# a 4096-token reasoning budget and SmallCTL's default 1024 reserve, every
# stream is cut off mid-thought and the run ends reasoning_only_stream_stall
# with no tool calls at all. 6144 clamps internally to limit//3 = 5461, which
# leaves ~1365 tokens for the answer after a full 4096 of thinking.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

LLAMA_SERVER="$SCRIPT_DIR/../llama-server.exe"
IMAGE="${IMAGE:-smallctl:pinned}"
PORT=8123
HOST=0.0.0.0
API_KEY="sk-bench"
TEMPERATURE=0.7; TOP_P=0.95; TOP_K=40
CTX=24576
THINK=512
RESERVE_COMPLETION=5120
REPEATS="${BENCH_REPEATS:-1}"
# Repeats are numbered from here, so a second pass can be run separately and
# merged: BENCH_REP_START=2 names its workspaces NN-r2-<model>, which is what
# grade-run.sh already expects for a second repeat.
REP_START="${BENCH_REP_START:-1}"
# Restrict the roster to a comma-separated list of aliases. Used to re-run only
# the models that are worth more cells.
ONLY_MODELS="${BENCH_MODELS:-}"

# Hard hand-back time. A cell that cannot finish before it is worse than no
# cell: it burns clock and leaves a torn workspace. Same guard as the pi arm.
DEADLINE="${BENCH_DEADLINE:-}"
DEADLINE_EPOCH=""
[[ -n "$DEADLINE" ]] && DEADLINE_EPOCH="$(date -d "$DEADLINE" +%s 2>/dev/null || echo "")"

# alias|repo|file|budget_seconds   (budgets from the pi run, see header)
MODELS=(
  "Granite-4.2-3B-Q8_0|ibm-granite/granite-4.2-3b-GGUF|granite-4.2-3b-Q8_0.gguf|1424"
  "Spark-X2.5-4B-Q6_K|sizzlebop/Spark-X2.5-4B-GGUF|Spark-X2.5-4B-Q6_K.gguf|1757"
  "Nanbeige4.2-3B-Q6_K|bartowski/Nanbeige_Nanbeige4.2-3B-GGUF|Nanbeige_Nanbeige4.2-3B-Q6_K.gguf|2426"
)
# Granite and Spark budgets are copied from bench-filter-20260914-203559.
# Nanbeige never ran under the current prompts, so it has none to copy: 2426 is
# its 9.40 tok/s (measured at depth in bench-filter-20260912-142607) put through
# the CURRENT formula, 12000/9.40*1.9. When the pi arm for Nanbeige is run, it
# must be forced to this same 2426s rather than re-measuring, or the two arms
# get different clocks and the comparison is void.

OUT="$SCRIPT_DIR/bench-smallctl-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$OUT"
LOG="$OUT/run.log"
log() { echo "[$(date +%H:%M:%S)] $*" | tee -a "$LOG"; }

# ---- prompts: identical file the pi arm used --------------------------------
PROMPTS=()
cur=""
while IFS= read -r line || [[ -n "$line" ]]; do
    if [[ "$line" == "===PROMPT===" ]]; then PROMPTS+=("$cur"); cur=""
    else cur+="$line"$'\n'; fi
done < prompts-filter.txt
[[ -n "$cur" ]] && PROMPTS+=("$cur")
# ---- parity: the SAME benchmark rules pi is given -------------------------
# pi receives these via --append-system-prompt. SmallCTL has no equivalent
# flag, so they are appended to the task text instead: same instructions to the
# same model, differing only in the channel the harness offers. Without them
# this arm is not comparable -- pi is told to use relative paths, that pip/npm
# are refused, how Node 24 handles .ts, how to background a server, and to
# verify before finishing. Judging SmallCTL without that guidance would measure
# the scaffolding pi got and SmallCTL did not.
#
# They are EXTRACTED FROM run-filter-bench.sh at runtime, never copy-pasted, so
# the two arms cannot drift apart when that file is edited.
# Read the quoted bash string: start at the assignment, strip the line-
# continuation backslashes, stop at the first line that does not continue.
# A sed range keyed on the final sentence silently ran to EOF and swept up
# 19k chars of the script itself, so the terminator is structural, not textual.
RULES="$(awk '/^APPEND_SYSTEM="/{f=1; sub(/^APPEND_SYSTEM="/,"")} f{cont=/\\$/; sub(/[[:space:]]*\\$/,""); if(!cont){sub(/"[[:space:]]*$/,""); print; exit} print}' run-filter-bench.sh)"
if [[ -z "$RULES" || ${#RULES} -lt 2000 || ${#RULES} -gt 6000 ]]; then
    log "!! could not extract the shared benchmark rules from run-filter-bench.sh (got ${#RULES} chars) — aborting"
    log "   without them this arm is not comparable to the pi arm."
    exit 2
fi
log "extracted ${#RULES} chars of shared benchmark rules from run-filter-bench.sh"

log "loaded ${#PROMPTS[@]} prompts from prompts-filter.txt"
(( ${#PROMPTS[@]} == 3 )) || { log "!! expected 3 prompts, got ${#PROMPTS[@]} — aborting"; exit 2; }

SERVER_PID=""
kill_server() {
    [[ -n "$SERVER_PID" ]] && kill "$SERVER_PID" 2>/dev/null
    # The pi arm kills by port too: a wedged server holds the GPU and every
    # later cell then fails for a reason that has nothing to do with the model.
    taskkill //F //IM llama-server.exe >/dev/null 2>&1
    SERVER_PID=""
    sleep 2
}
trap 'kill_server; log "interrupted"; exit 130' INT TERM

start_server() {
    local repo="$1" file="$2" alias="$3"
    kill_server
    "$LLAMA_SERVER" -hf "$repo" -hff "$file" \
        --alias "$alias" --jinja -c "$CTX" -ngl 999 --parallel 1 \
        --reasoning-budget "$THINK" \
        --temp "$TEMPERATURE" --top-p "$TOP_P" --top-k "$TOP_K" \
        --api-key "$API_KEY" --host "$HOST" --port "$PORT" \
        > "$OUT/server-$alias.log" 2>&1 &
    SERVER_PID=$!
    # 900 x 2s = 30 min. Generous on purpose: the FIRST start of a model also
    # downloads its weights via -hf, and Nanbeige is not in the cache. A short
    # wait would read that download as a failed server and skip the model.
    for _ in $(seq 1 900); do
        if curl -s -m 3 -H "Authorization: Bearer $API_KEY" \
               "http://127.0.0.1:$PORT/health" | grep -q '"status":"ok"'; then
            # Believe the server, not the request — it caps -c at the training
            # context and a silent cap would make the budget a lie.
            local actual
            actual="$(curl -s -H "Authorization: Bearer $API_KEY" \
                "http://127.0.0.1:$PORT/props" \
                | jq -r '.default_generation_settings.n_ctx // empty' 2>/dev/null)"
            log "  server up for $alias (n_ctx=$actual)"
            curl -s -H "Authorization: Bearer $API_KEY" "http://127.0.0.1:$PORT/props" \
                | jq '{n_ctx: .default_generation_settings.n_ctx}' > "$OUT/server-$alias-props.json"
            return 0
        fi
        sleep 2
    done
    log "  !! server failed to come up for $alias"
    return 1
}

# Filter the roster BEFORE counting cells, or TOTAL and the deadline guard both
# reason about models that are not going to run.
if [[ -n "$ONLY_MODELS" ]]; then
    KEEP=()
    for spec in "${MODELS[@]}"; do
        a="${spec%%|*}"
        case ",$ONLY_MODELS," in *",$a,"*) KEEP+=("$spec") ;; esac
    done
    MODELS=("${KEEP[@]}")
    (( ${#MODELS[@]} > 0 )) || { log "!! BENCH_MODELS matched nothing — aborting"; exit 2; }
    log "roster restricted to: $ONLY_MODELS (${#MODELS[@]} model(s))"
fi

IDX=0
TOTAL=$(( ${#MODELS[@]} * ${#PROMPTS[@]} * REPEATS ))
log "=== SmallCTL arm: ${#MODELS[@]} models x ${#PROMPTS[@]} tasks x $REPEATS reps (from r$REP_START) = $TOTAL cells ==="
[[ -n "$DEADLINE_EPOCH" ]] && log "deadline: $DEADLINE"

for mi in "${!MODELS[@]}"; do
    IFS='|' read -r ALIAS REPO FILE BUDGET <<< "${MODELS[$mi]}"
    log "=== $ALIAS (budget ${BUDGET}s/cell) ==="
    start_server "$REPO" "$FILE" "$ALIAS" || { echo "$ALIAS: server failed" >> "$OUT/SKIPPED.txt"; continue; }

    for REP in $(seq "$REP_START" $(( REP_START + REPEATS - 1 ))); do
        NUM=0
        for PROMPT in "${PROMPTS[@]}"; do
            ((NUM+=1)); ((IDX+=1))

            if [[ -n "$DEADLINE_EPOCH" ]]; then
                # Reserve the floor budget for every cell still owed to LATER
                # models, so a slow first model cannot starve the second.
                reserve=0
                for mj in "${!MODELS[@]}"; do
                    (( mj <= mi )) && continue
                    IFS='|' read -r _ _ _ b <<< "${MODELS[$mj]}"
                    reserve=$(( reserve + b * ${#PROMPTS[@]} * REPEATS ))
                done
                need=$(( $(date +%s) + BUDGET + reserve ))
                if (( need > DEADLINE_EPOCH )); then
                    log "    SKIPPED by deadline guard (task $NUM rep $REP)"
                    echo "$ALIAS task $NUM repeat $REP: skipped, deadline guard" >> "$OUT/SKIPPED-DEADLINE.txt"
                    continue
                fi
            fi

            WS="$OUT/$(printf '%02d' "$NUM")-r${REP}-$ALIAS"
            mkdir -p "$WS"
            printf '%s' "$PROMPT" > "$WS/prompt.txt"

            log "[$IDX/$TOTAL] task $NUM rep $REP — $ALIAS"
            t0=$(date +%s)
            cname="sctl-$(printf '%02d' "$NUM")r${REP}-$(echo "$ALIAS" | tr -cd 'A-Za-z0-9')-$$"

            # -k 15 -s TERM: ask the harness to stop and give it 15s to flush
            # its run logs before SIGKILL, so a capped cell still leaves a
            # readable task_summary.json.
            (
                MSYS_NO_PATHCONV=1 timeout -k 15 -s TERM "$BUDGET" \
                docker run --rm --name "$cname" \
                    --add-host host.docker.internal:host-gateway \
                    -v "$(cygpath -w "$WS")":/work -w /work \
                    -e SMALLCTL_ENDPOINT="http://host.docker.internal:$PORT/v1" \
                    -e SMALLCTL_MODEL="$ALIAS" \
                    -e SMALLCTL_API_KEY="$API_KEY" \
                    -e SMALLCTL_PROVIDER_PROFILE=llamacpp \
                    -e SMALLCTL_CONTEXT_LIMIT="$CTX" \
                    -e SMALLCTL_RESERVE_COMPLETION_TOKENS="$RESERVE_COMPLETION" \
                    "$IMAGE" \
                    --run-mode loop \
                    --provider-profile llamacpp \
                    --reasoning-mode auto \
                    --context-limit "$CTX" \
                    --max-prompt-tokens "$CTX" \
                    --reserve-completion-tokens "$RESERVE_COMPLETION" \
                    --task "$PROMPT

$RULES" \
                    < /dev/null
            ) > "$WS/transcript.jsonl" 2> "$WS/stderr.log"
            rc=$?
            # GNU timeout only kills the docker CLI; the container must die too.
            docker rm -f "$cname" >/dev/null 2>&1 || true
            t1=$(date +%s)

            # Cheap triage signals, same spirit as the pi arm's meta.txt. The
            # authoritative verdict comes from grade-run.sh, not from these.
            status="$(grep -ho '"final_task_status": "[a-z_]*"' "$WS"/logs/*/task_summary.json 2>/dev/null | head -1 | sed 's/.*: "//;s/"//')"
            calls="$(grep -ho '"total_tool_calls": [0-9]*' "$WS"/logs/*/task_summary.json 2>/dev/null | head -1 | grep -o '[0-9]*')"
            {
                echo "run: $NUM"
                echo "repeat: $REP"
                echo "model: $ALIAS"
                echo "workspace: $WS"
                echo "harness: smallctl"
                echo "exit_code: $rc"
                echo "duration_sec: $((t1-t0))"
                echo "budget_sec: $BUDGET"
                echo "final_task_status: ${status:-unknown}"
                echo "total_tool_calls: ${calls:-0}"
            } > "$WS/meta.txt"
            log "    rc=$rc $((t1-t0))s status=${status:-unknown} tool_calls=${calls:-0}"
            echo "run: $NUM model: $ALIAS repeat: $REP exit_code: $rc duration_sec: $((t1-t0)) status: ${status:-unknown}" >> "$OUT/SUMMARY.txt"
        done
    done
    log "=== finished $ALIAS ==="
done

kill_server

{
    echo "# SmallCTL-arm summary — $(date)"
    echo "harness: SmallCTL @ 1ce1cb5, --run-mode loop, explicit flags (NO preset), image $IMAGE"
    echo "tasks: 3 (prompts-filter.txt, byte-identical to the pi arm)"
    echo "repeats: $REPEATS independent runs per (model, task)"
    echo "sampling: temp=$TEMPERATURE top_p=$TOP_P top_k=$TOP_K, seed unset"
    echo "NOT COMPARABLE to the pi arm at 16384 — SmallCTL cannot assemble a prompt there (see script header)"
    echo "context: $CTX  reasoning_budget: $THINK  completion_reserve: $RESERVE_COMPLETION"
    echo "budgets: per-model wall clock copied from bench-filter-20260914-203559"
    echo "shared rules: pi's APPEND_SYSTEM text, appended to the task (SmallCTL has no system-prompt flag)"
    echo "sandbox: docker ($IMAGE) — node v24.21.0, python3, curl, root (matches pi's)"
    echo "pi arm for comparison: bench-filter-20260914-203559 (same llama-server.exe, dated 2026-09-10)"
    echo
    cat "$OUT/SUMMARY.txt" 2>/dev/null
} > "$OUT/SUMMARY.txt.new" && mv "$OUT/SUMMARY.txt.new" "$OUT/SUMMARY.txt"

log "=== done. run dir: $OUT ==="
log "grade with: ./grade-run.sh $(basename "$OUT")"
