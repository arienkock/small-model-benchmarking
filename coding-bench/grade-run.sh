#!/usr/bin/env bash
#
# grade-run.sh — objective, execution-based grading for a filter-round result dir.
#
#   ./grade-run.sh bench-filter-20260912-083544
#
# WHY THIS EXISTS
#
# Round 1 was triaged with grep over the transcript, and the grep got the
# ranking backwards:
#
#   * Nanbeige printed "all tests passed" TWICE before a single assertion ran
#     (its verdict was `calls.every(...)` evaluated synchronously against an
#     empty array), and scored PASS=20.
#   * Apertus scored PASS=6 with zero tool calls and zero files on disk — the
#     phrase was matched in the prompt text echoed back into the transcript.
#   * Granite, the ONLY model that fixed all three seeded debounce bugs, could
#     not be distinguished from models that fixed one.
#
# So: never grade a model by what it SAYS. Import the function it exported and
# call it. Start the server it wrote and curl it. This script writes
# GRADES.txt / grades.tsv next to the run's other reports and mutates nothing
# inside the run directories — every check runs on a copy.
#
# Exit status is always 0: a failing model is data, not a script error.

set -u

RUN_DIR="${1:-}"
[[ -n "$RUN_DIR" && -d "$RUN_DIR" ]] || { echo "usage: $0 <bench-filter-DIR>" >&2; exit 2; }
RUN_DIR="$(cd "$RUN_DIR" && pwd)"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
GRADERS="$SCRIPT_DIR/graders"
WORK="$RUN_DIR/.grading"

command -v node    >/dev/null || { echo "node not found"    >&2; exit 2; }
command -v python3 >/dev/null || { echo "python3 not found" >&2; exit 2; }
command -v curl    >/dev/null || { echo "curl not found"    >&2; exit 2; }

NODE_MAJOR="$(node --version | sed 's/^v\([0-9]*\).*/\1/')"
[[ "$NODE_MAJOR" == "24" ]] || echo "WARNING: node major is $NODE_MAJOR, the benchmark uses 24 — results may differ" >&2

rm -rf "$WORK"; mkdir -p "$WORK"

# Ports a model might have hard-coded. Probed in order until one answers.
# 5000 is deliberately NOT here: on macOS the AirPlay Receiver (ControlCenter)
# holds it permanently, which would make the free-port check below fail forever
# on the analysis machine. Round 1's models used 8000 and 8080.
CANDIDATE_PORTS=(8000 8080 8888 3000)

# A port left occupied by an earlier server makes every later curl hit the WRONG
# server and report a bogus 404 for everyone. (This bit the manual analysis of
# round 1.) Refuse to grade servers unless the candidate ports start out free.
# Uses /dev/tcp, not lsof: the benchmark host is Windows/Git Bash, where lsof
# does not exist. With lsof the check silently succeeded (command-not-found was
# read as "port free") and the safety net was gone on the one machine that runs
# the benchmark.
port_in_use() { (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null && { exec 3<&- 3>&- 2>/dev/null; return 0; }; return 1; }

check_ports_free() {
    local busy=""
    for p in "${CANDIDATE_PORTS[@]}"; do
        if port_in_use "$p"; then busy="$busy $p"; fi
    done
    echo "$busy"
}

# Hard timeout for a single node invocation. A model's module can hang the
# grader forever: Nanbeige's round-2 throttle.ts ends in
# `await new Promise(r => setTimeout(200, r))` — arguments swapped — which never
# settles, so importing it blocks. GNU timeout is not on the Windows bench host
# and not on macOS by default, so do it with a watchdog subshell.
NODE_TIMEOUT="${GRADE_NODE_TIMEOUT:-30}"
run_with_timeout() {
    local secs="$1"; shift
    "$@" & local p=$!
    # The watchdog's stdio MUST be detached. Callers run this inside $( ), and a
    # command substitution does not return until every process holding the write
    # end of its pipe has exited — a sleeping watchdog holds it, so without this
    # redirect every single node run blocks for the full timeout even after node
    # has already exited, turning a 2-minute grading pass into 20 minutes.
    ( sleep "$secs"; kill -9 "$p" 2>/dev/null ) >/dev/null 2>&1 </dev/null & local w=$!
    wait "$p" 2>/dev/null; local rc=$?
    kill -9 "$w" 2>/dev/null; wait "$w" 2>/dev/null
    return $rc
}

# run_node_file <dir> <file> -> prints "rc<TAB>first-meaningful-line"
#
# Two round-2 bugs fixed here:
#   1. The reported line was `grep ... | head -1`, i.e. the FIRST matching line
#      of combined output. When the model's own module prints before the grader
#      does, GRADER_OK is never seen and a passing deliverable is filed as
#      NO_SIGNAL. Search the whole output for GRADER_OK instead.
#   2. No timeout — see run_with_timeout above.
run_node_file() {
    local dir="$1" file="$2" out rc
    out="$(cd "$dir" && run_with_timeout "$NODE_TIMEOUT" node "$file" 2>&1)"; rc=$?
    # 137 = SIGKILL from the watchdog: the module never returned.
    [[ $rc -eq 137 ]] && { printf '%s\t%s' 137 "HANG: no exit within ${NODE_TIMEOUT}s (unsettled promise or blocked import)"; return; }
    local line
    if grep -q 'GRADER_OK' <<<"$out"; then
        line="$(grep -m1 'GRADER_OK' <<<"$out")"
    else
        line="$(grep -E 'Error|error|assert' <<<"$out" | head -1)"
        [[ -z "$line" ]] && line="$(head -1 <<<"$out")"
    fi
    printf '%s\t%s' "$rc" "$(cut -c1-120 <<<"$line" | tr '\t\n' '  ')"
}

# Grade a deliverable with the model's own entry-point/self-test block removed,
# so a correct algorithm behind broken scaffolding is still visible.
#
# Round 2's three most misleading verdicts were all this: Nanbeige's throttle
# and averageSpeed are CORRECT and were scored RUN_FAIL purely because its test
# block would not load. Keeping both numbers separates "cannot write the
# algorithm" from "cannot package it", which are different problems with
# different fixes.
strip_selftest() {                # <src> <dst>
    awk '
      /^[[:space:]]*(if[[:space:]]*\([[:space:]]*(require\.main|import\.meta)|\/\/[^A-Za-z0-9]*[Ss]elf[- ]?test|const[[:space:]]+__isMain)/ { exit }
      /^[[:space:]]*import[[:space:]]+assert/ && seen_export { exit }
      /^[[:space:]]*export[[:space:]]/ { seen_export=1 }
      { print }
    ' "$1" > "$2"
}

# classify <rc> <text> <okmarker>
classify() {
    local rc="$1" text="$2" ok="$3"
    if [[ "$rc" == "0" ]] && grep -q "$ok" <<<"$text"; then echo "PASS"
    elif grep -qE 'AssertionError' <<<"$text";                then echo "LOGIC_FAIL"
    elif grep -qE 'SyntaxError|ReferenceError|TypeError|Cannot find|does not provide' <<<"$text"; then echo "LOAD_FAIL"
    elif [[ "$rc" != "0" ]];                                  then echo "RUN_FAIL"
    else echo "NO_SIGNAL"; fi
}

# split_verdict <shipped> <logic> -> "algo<TAB>pkg"
#
# Round 4 (bench-filter-20260913-141131) is why this exists. Scored on the
# shipped file the three models ran 4/12, 7/12 and 8/12; scored on the
# algorithm alone they were identical at 8/12 each, with the same 3 real logic
# bugs apiece. The entire spread was deliverables whose algorithm was correct
# and whose own self-test block stopped them loading — Granite 4, Nanbeige 1,
# Spark 0. One verdict per component cannot say that, so emit two.
#
#   algo = is the exported function correct?
#   pkg  = does the file the model shipped load and run as delivered?
#
# They are orthogonal. LOGIC_FAIL is pkg:PASS — the file imported fine and the
# grader got to call it; it just answered wrong. LOAD_FAIL/RUN_FAIL is
# pkg:FAIL, and then algo depends on the strip: if the algorithm passes once
# the self-test is removed, the packaging is the whole defect.
#
# algo:UNKNOWN is a real third state, not a polite FAIL: the file will not load
# even with the self-test stripped, so the grader never called the function and
# has no evidence either way. Granite's round-4 02-r2 throttle is the case —
# `const timestamps = []` reassigned, a parse error that hides whatever the
# algorithm would have done. Counting that as an algorithm failure would assert
# something the grader did not measure.
#
# MISSING counts as a failure in BOTH columns. Shipping nothing is not an
# absence of evidence, and filing it as UNKNOWN would let a model improve its
# algorithm score by writing no file at all.
split_verdict() {
    local shipped="$1" logic="$2"
    case "$shipped" in
        MISSING)              printf 'MISSING\tMISSING'; return ;;
        PASS)                 printf 'PASS\tPASS';       return ;;
        LOGIC_FAIL|NO_SIGNAL) printf 'FAIL\tPASS';       return ;;
    esac
    # LOAD_FAIL / RUN_FAIL / HANG: it did not load or run as shipped.
    case "$logic" in
        PASS)       printf 'PASS\tFAIL'    ;;
        LOGIC_FAIL) printf 'FAIL\tFAIL'    ;;
        *)          printf 'UNKNOWN\tFAIL' ;;
    esac
}

# ---------------------------------------------------------------- task 1 ---
# grade_module <workdir> <deliverable.ts> <grader.ts> -> "shipped<TAB>logic<TAB>text"
#
# shipped = the grader run against the file exactly as the model left it.
# logic   = the same grader against the file with the model's own self-test
#           block removed. When these differ, the algorithm is right and the
#           packaging is wrong — a different failure with a different fix, and
#           the distinction round 2 could not express.
grade_module() {
    local d="$1" file="$2" grader="$3"
    local g grc gtxt shipped logic
    cp "$GRADERS/$grader" "$d/"
    g="$(run_node_file "$d" "$grader")"; grc="${g%%$'\t'*}"; gtxt="${g#*$'\t'}"
    shipped="$(classify "$grc" "$gtxt" GRADER_OK)"

    # The logic pass exists for ONE question: did a correct algorithm fail only
    # because of its own scaffolding? That question is meaningless when the file
    # already passes, and stripping can itself break a working file (it cuts at
    # a heuristic boundary). So only run it when the shipped file failed, and
    # only ever report it as an upgrade — never let the strip manufacture a
    # failure that the real deliverable does not have.
    logic="-"
    if [[ "$shipped" != "PASS" ]]; then
        local ld="$d-logic"; mkdir -p "$ld"
        echo '{"type":"module"}' > "$ld/package.json"
        strip_selftest "$d/$file" "$ld/$file"
        cp "$GRADERS/$grader" "$ld/"
        local lg lrc ltxt
        lg="$(run_node_file "$ld" "$grader")"; lrc="${lg%%$'\t'*}"; ltxt="${lg#*$'\t'}"
        logic="$(classify "$lrc" "$ltxt" GRADER_OK)"
    fi

    # Only surface the logic text when it says something the shipped text does not.
    # Round 3 showed the stale-text case matters: when the logic run fails with a
    # DIFFERENT error than the shipped run, the shipped error is what got printed
    # and it was often the more superficial one. Granite r3 and LFM2.5 r2 both
    # displayed a packaging-shaped "Cannot determine intended module format" when
    # the real defect in each was "Assignment to constant variable" — an algorithm
    # bug reported as a packaging bug. Print the logic text whenever it ran.
    local text="$gtxt"
    if [[ "$logic" == "PASS" && "$shipped" != "PASS" ]]; then
        text="$gtxt  [scaffolding-only failure: the algorithm passes]"
    elif [[ "$logic" != "-" && "$logic" != "PASS" && -n "${ltxt:-}" && "$ltxt" != "$gtxt" ]]; then
        text="$gtxt  [logic-run: $ltxt]"
    fi
    printf '%s\t%s\t%s' "$shipped" "$logic" "$text"
}

grade_task1() {                       # <workspace> -> tsv fields
    local ws="$1" d="$WORK/$(basename "$ws")"
    [[ -f "$ws/debounce.ts" ]] || { printf 'MISSING\tMISSING\tMISSING\tno debounce.ts'; return; }
    mkdir -p "$d"; cp "$ws/debounce.ts" "$d/"; echo '{"type":"module"}' > "$d/package.json"

    # (a) the model's own file, exactly as it shipped it.
    #
    # The pass string is searched for in the COMPLETE output. This used to test
    # only the single 120-char line run_node_file returns, so a model whose
    # self-test printed anything before "all tests passed" was filed SELF_SILENT
    # — the false-pass detector silently missing false passes. LFM2.5's round-2
    # debounce is exactly that case, and the mismatch was initially misread as a
    # Windows/macOS platform difference. It is not; it is this bug.
    local ownout ownrc
    ownout="$(cd "$d" && run_with_timeout "$NODE_TIMEOUT" node debounce.ts 2>&1)"; ownrc=$?
    local self="SELF_FAIL"
    if [[ "$ownrc" == "0" ]]; then
        if grep -qi 'all tests passed' <<<"$ownout"; then self="SELF_PASS"; else self="SELF_SILENT"; fi
    elif [[ "$ownrc" == "137" ]]; then
        self="SELF_HANG"
    fi

    # (b) the exported function, graded shipped and logic-only
    local m; m="$(grade_module "$d" debounce.ts debounce.grader.ts)"
    IFS=$'\t' read -r shipped logic gtxt <<<"$m"
    printf '%s\t%s\t%s\t%s' "$shipped" "$logic" "$self" "$gtxt"
}

# ---------------------------------------------------------------- servers --
# start <dir> <file>, find the port it answers on, run <probe-fn>, always kill.
#
# Port discovery MUST use the endpoint the task actually specifies, not "/".
# Nanbeige's task-3 server raises ValueError on a query-less request
# (`key, val = pair.split('=')`), so probing "/" killed the connection and the
# server looked dead on every port — a grader artifact that would have scored a
# working server as NO_LISTENER. Grade the spec, not an unspecified path.
# Every TCP port in LISTEN state, one per line, sorted. Portable across the
# Windows bench host (Git Bash netstat, "LISTENING", addr:port) and macOS
# (BSD netstat, "LISTEN", addr.port) by taking the first addr/port token on
# each listening line and keeping whatever follows the last : or .
listening_ports() {
    netstat -an 2>/dev/null \
    | awk '/LISTEN/{for(i=1;i<=NF;i++){if($i ~ /[.:][0-9]+$/){sub(/.*[.:]/,"",$i); print $i; break}}}' \
    | sort -u
}

with_server() {
    local dir="$1" py="$2" probe="$3" discover="$4" pid port=""
    listening_ports > "$dir/.ports-before"
    ( cd "$dir" && exec python3 "$py" > server.out 2>&1 ) &
    pid=$!
    sleep 2.5
    if ! kill -0 "$pid" 2>/dev/null; then
        echo "SERVER_DIED|$(grep -E 'Error|error' "$dir/server.out" 2>/dev/null | tail -1 | cut -c1-100)"
        wait "$pid" 2>/dev/null; return
    fi
    # Discover the port the server ACTUALLY listens on, by diffing the listen
    # table around startup. Round 2 probed a fixed list of four ports and scored
    # two working Granite servers NO_LISTENER: one binds 5000 (deliberately not
    # in the list, because macOS AirPlay holds it — but grading ran on Windows,
    # where it is free), the other binds port 0 for an ephemeral port. Neither
    # task specifies a port, so a fixed list is the grader inventing a
    # requirement. Discover it instead, and report which port was used.
    port="$(comm -13 "$dir/.ports-before" <(listening_ports) 2>/dev/null | head -1)"
    # Fall back to the candidate list if the diff found nothing (another process
    # may have opened a port in the same window, or lsof/ss may be unavailable).
    if [[ -z "$port" ]]; then
        for p in "${CANDIDATE_PORTS[@]}"; do
            if (exec 3<>"/dev/tcp/127.0.0.1/$p") 2>/dev/null; then
                exec 3<&- 3>&- 2>/dev/null; port="$p"; break
            fi
        done
    fi
    # Fallback for a bash built without /dev/tcp: pay the quota rather than
    # fail to find the server at all.
    if [[ -z "$port" && -n "$discover" ]]; then
        for p in "${CANDIDATE_PORTS[@]}"; do
            if [[ "$(curl -s -o /dev/null -m 3 -w '%{http_code}' "http://127.0.0.1:$p$discover" 2>/dev/null)" != "000" ]]; then
                port="$p"; break
            fi
        done
        [[ -n "$port" ]] && echo "NOTE: /dev/tcp unavailable; discovery consumed one request" >&2
    fi
    if [[ -z "$port" ]]; then
        echo "NO_LISTENER|process alive but opened no listening port"
    else
        # Report the port so a NO_LISTENER can never again be confused with a
        # server that simply chose a port the grader did not think to try.
        local res; res="$($probe "$port")"
        echo "${res%%|*}|port $port: ${res#*|}"
    fi
    kill -9 "$pid" 2>/dev/null; wait "$pid" 2>/dev/null; rm -f "$dir/.ports-before"; sleep 0.4
}

probe_ratelimit() {                   # 5x200 then 429 + Retry-After
    local port="$1" codes="" c
    for i in 1 2 3 4 5 6; do
        c="$(curl -s -o /dev/null -m 3 -w '%{http_code}' "http://127.0.0.1:$port/api/time")"
        codes="$codes$c "
    done
    local retry
    retry="$(curl -s -D - -o /dev/null -m 3 "http://127.0.0.1:$port/api/time" | grep -ci '^Retry-After:')"
    if [[ "$codes" == "200 200 200 200 200 429 " ]]; then
        [[ "$retry" -gt 0 ]] && echo "PASS|5x200 then 429 with Retry-After" \
                             || echo "PARTIAL|429 on the 6th but no Retry-After header"
    else
        echo "FAIL|codes: ${codes}(want 200 200 200 200 200 429)"
    fi
}

# Task 3 (suite T4): the seeded bugs in the books server, graded as THREE
# independent components rather than one pass/fail, because they are three
# different abilities and round 4 showed a single verdict hides that.
#
#   status   200 on /api/books and 404 on an unknown path. The shape is already
#            right in the buggy original, so this is the "did not break it" check.
#   body     valid JSON with both seeded books. Also already right in the
#            original — together with status it catches a "fix" that broke
#            something that worked.
#   headers  Content-Type: application/json AND a correct Content-Length. THIS
#            is the seeded bug, and the reason this task replaced the average-
#            speed one. Verified against the unmodified original: `curl` alone
#            returns valid JSON and 200, so a model that checks only the body
#            sees a working server and stops. Only inspecting the response
#            headers (curl -i / -v) reveals Content-Length is absent. The task
#            therefore separates models that verify thoroughly from models that
#            verify at all, which round 4 found to be the sharpest axis in the
#            benchmark and could previously only measure from the transcript.
probe_books() {
    local port="$1" code404 code200 ctype clen body blen
    code200="$(curl -s -o /dev/null -m 3 -w '%{http_code}' "http://127.0.0.1:$port/api/books")"
    code404="$(curl -s -o /dev/null -m 3 -w '%{http_code}' "http://127.0.0.1:$port/nope")"
    body="$(curl -s -m 3 "http://127.0.0.1:$port/api/books")"
    # Header names are case-insensitive; normalise before matching.
    local hdrs; hdrs="$(curl -s -D - -o /dev/null -m 3 "http://127.0.0.1:$port/api/books" | tr 'A-Z' 'a-z')"
    ctype="$(sed -n 's/^content-type:[[:space:]]*//p' <<<"$hdrs" | tr -d '\r' | head -1)"
    clen="$(sed -n 's/^content-length:[[:space:]]*//p' <<<"$hdrs" | tr -d '\r' | head -1)"
    blen="$(printf '%s' "$body" | wc -c | tr -d ' ')"

    local st="FAIL" bd="FAIL" hd="FAIL" why=""
    [[ "$code200" == "200" && "$code404" == "404" ]] && st="PASS" \
        || why="$why status(/api/books=$code200 /nope=$code404)"
    # Both seeded books present and the payload parses as JSON.
    if python3 -c "
import json,sys
d=json.loads(sys.stdin.read())
t={b.get('title') for b in d}
sys.exit(0 if {'Dune','1984'} <= t and len(d)==2 else 1)" <<<"$body" 2>/dev/null; then
        bd="PASS"
    else
        why="$why body(not the 2 seeded books as JSON)"
    fi
    if [[ "$ctype" == application/json* && -n "$clen" && "$clen" == "$blen" ]]; then
        hd="PASS"
    elif [[ -z "$clen" ]]; then
        why="$why headers(no Content-Length — the seeded bug)"
    elif [[ "$clen" != "$blen" ]]; then
        why="$why headers(Content-Length $clen, body is $blen)"
    else
        why="$why headers(Content-Type '${ctype:-none}')"
    fi
    echo "$st|$bd|$hd|${why:-200/404, 2 books, Content-Type and Content-Length correct}"
}

probe_avgspeed() {                    # 48 on valid input, 400 when hours=0
    local port="$1" ok bad okcode badcode
    ok="$(curl -s -m 3 "http://127.0.0.1:$port/api/average-speed?distance=240&hours=5")"
    okcode="$(curl -s -o /dev/null -m 3 -w '%{http_code}' "http://127.0.0.1:$port/api/average-speed?distance=240&hours=5")"
    badcode="$(curl -s -o /dev/null -m 3 -w '%{http_code}' "http://127.0.0.1:$port/api/average-speed?distance=240&hours=0")"
    local speed
    speed="$(sed -n 's/.*"average_speed"[[:space:]]*:[[:space:]]*\([0-9.]*\).*/\1/p' <<<"$ok")"
    if [[ "$okcode" == "200" && "$speed" =~ ^48(\.0+)?$ && "$badcode" == "400" ]]; then
        echo "PASS|200/48 and 400 on hours=0"
    else
        echo "FAIL|valid=$okcode speed=${speed:-none} hours0=$badcode"
    fi
}

grade_task2() {
    local ws="$1" d="$WORK/$(basename "$ws")"; mkdir -p "$d"; echo '{"type":"module"}' > "$d/package.json"
    local tres="MISSING" tlog="MISSING" ttxt="no throttle.ts" sres="MISSING|no server.py"
    if [[ -f "$ws/throttle.ts" ]]; then
        cp "$ws/throttle.ts" "$d/"
        local m; m="$(grade_module "$d" throttle.ts throttle.grader.ts)"
        IFS=$'\t' read -r tres tlog ttxt <<<"$m"
    fi
    [[ -f "$ws/server.py" ]] && { cp "$ws/server.py" "$d/"; sres="$(with_server "$d" server.py probe_ratelimit /api/time)"; }
    printf '%s\t%s\t%s\t%s' "$tres" "$tlog" "${sres%%|*}" "$(echo "${sres#*|} ; throttle: $ttxt" | tr '\t\n' '  ' | cut -c1-170)"
}

grade_task3() {
    # Suite T4: one deliverable (server.py), three components. There is no .ts
    # module in this task, so no algo/pkg split applies — a Python server either
    # behaves or it does not.
    local ws="$1" d="$WORK/$(basename "$ws")"; mkdir -p "$d"
    local st="MISSING" bd="MISSING" hd="MISSING" why="no server.py"
    if [[ -f "$ws/server.py" ]]; then
        cp "$ws/server.py" "$d/"
        local res; res="$(with_server "$d" server.py probe_books /api/books)"
        # with_server returns "<verdict>|port N: <detail>"; for probe_books the
        # verdict slot carries the three sub-verdicts joined by |.
        local head="${res%%|*}" rest="${res#*|}"
        if [[ "$head" == "SERVER_DIED" || "$head" == "NO_LISTENER" || "$head" == "MISSING" ]]; then
            st="$head"; bd="$head"; hd="$head"; why="$rest"
        else
            # with_server rebuilds its return as "<field1>|port N: <the rest>",
            # so the port label lands in front of the SECOND field. Split all
            # four, then peel the label off and keep it in the detail text.
            local f2 label=""
            IFS='|' read -r st f2 hd why <<<"$res"
            if [[ "$f2" == port\ *:* ]]; then label="${f2%%:*}: "; bd="${f2#*: }"; else bd="$f2"; fi
            why="$label$why"
        fi
    fi
    printf '%s\t%s\t%s\t%s' "$st" "$bd" "$hd" "$(echo "$why" | tr '\t\n' '  ' | cut -c1-170)"
}

# ------------------------------------------------------------------ main ---
BUSY="$(check_ports_free)"
if [[ -n "$BUSY" ]]; then
    echo "REFUSING TO GRADE SERVERS: port(s)$BUSY already in use." >&2
    echo "Free them first, or every server probe will hit the wrong process." >&2
    exit 2
fi

TSV="$RUN_DIR/grades.tsv"
: > "$TSV"
printf 'task\trep\tmodel\tverdict\tdetail\n' >> "$TSV"

# Workspaces are <task>-r<rep>-<model> since round 3 (repeats). Round 1 and 2
# dirs are <task>-<model>; treat those as rep 1 so old runs still grade.
for ws in "$RUN_DIR"/[0-9][0-9]-*/; do
    ws="${ws%/}"
    base="$(basename "$ws")"
    num="${base%%-*}"; rest="${base#*-}"
    if [[ "$rest" =~ ^r([0-9]+)-(.*)$ ]]; then
        rep="${BASH_REMATCH[1]}"; model="${BASH_REMATCH[2]}"
    else
        rep=1; model="$rest"
    fi
    # The verdict column carries the SPLIT verdicts (<component>.algo /
    # <component>.pkg); the raw shipped and logic-only results move into detail,
    # where they stay available for diagnosis without being the headline number.
    case "$num" in
        01) IFS=$'\t' read -r v lv self detail <<<"$(grade_task1 "$ws")"
            IFS=$'\t' read -r algo pkg <<<"$(split_verdict "$v" "$lv")"
            printf '1\t%s\t%s\tdebounce.algo:%s debounce.pkg:%s\tshipped:%s logic:%s self:%s  %s\n' \
                "$rep" "$model" "$algo" "$pkg" "$v" "$lv" "$self" "$detail" >> "$TSV" ;;
        02) IFS=$'\t' read -r tv tl sv detail <<<"$(grade_task2 "$ws")"
            IFS=$'\t' read -r algo pkg <<<"$(split_verdict "$tv" "$tl")"
            printf '2\t%s\t%s\tthrottle.algo:%s throttle.pkg:%s server:%s\tshipped:%s logic:%s  %s\n' \
                "$rep" "$model" "$algo" "$pkg" "$sv" "$tv" "$tl" "$detail" >> "$TSV" ;;
        03) IFS=$'\t' read -r st bd hd detail <<<"$(grade_task3 "$ws")"
            printf '3\t%s\t%s\tbooks.status:%s books.body:%s books.headers:%s\t%s\n' \
                "$rep" "$model" "$st" "$bd" "$hd" "$detail" >> "$TSV" ;;
    esac
    echo "  graded $base"
done

# ------------------------------------------------------- stability table ---
# The reason repeats exist. One row per (model, component) with a PASS count out
# of N repeats. A component that is 3/3 or 0/3 is a finding; one that is 1/3 or
# 2/3 is noise, and rounds 1-2 (n=1) reported exactly that noise as a ranking.
STAB="$RUN_DIR/STABILITY.txt"
{
    echo "# Cross-repeat stability — $(date)"
    echo "# PASS count per component, over the repeats present in this run dir."
    echo "# n/n or 0/n = a real signal. Anything in between = the cell is a coin flip"
    echo "# and must not be used to rank models."
    echo
    echo "# algo:UNKNOWN cells are excluded from the denominator, not scored as"
    echo "# failures — the file would not load even stripped, so the grader never"
    echo "# called the function. They are reported separately as (+N unknown)."
    echo
    awk -F'\t' 'NR>1 {
        task=$1; model=$3; verdict=$4;
        n=split(verdict, parts, " ");
        for (i=1; i<=n; i++) {
            comp=parts[i]; val=comp;
            if (index(comp,":")>0) { split(comp,kv,":"); comp=kv[1]; val=kv[2] }
            else { comp="debounce"; val=parts[i] }
            key=model SUBSEP "t" task "." comp;
            seen[key]=1;
            if (val=="UNKNOWN") { unk[key]++ }
            else { den[key]++; if (val=="PASS") pass[key]++ }
        }
    }
    END {
        printf "%-30s %-22s %8s\n", "MODEL", "COMPONENT", "PASS/N";
        for (k in seen) {
            split(k, a, SUBSEP);
            p = (k in pass) ? pass[k] : 0;
            d = (k in den)  ? den[k]  : 0;
            u = (k in unk)  ? unk[k]  : 0;
            flag = (d==0 || p==d || p==0) ? "" : "   <-- unstable";
            note = (u>0) ? sprintf("  (+%d unknown)", u) : "";
            printf "%-30s %-22s %5d/%d%s%s\n", a[1], a[2], p, d, note, flag
        }
    }' "$TSV" | { read -r hdr; echo "$hdr"; sort; }
} > "$STAB"

# ----------------------------------------------------- algorithm/packaging --
# The headline table. Round 4 shipped one number per component and it hid the
# only difference between the three shortlisted models: identical algorithms,
# very different ability to hand over a file that loads. Aggregate the split
# per model so that is the first thing the round reports.
SPLIT="$RUN_DIR/SPLIT.txt"
{
    echo "# Algorithm vs packaging — $(date)"
    echo "#"
    echo "# ALGO = the exported function, graded with the model's own self-test"
    echo "#        block stripped. Can it write the code?"
    echo "# PKG  = the file exactly as the model shipped it. Does it load and run?"
    echo "# DEATHS = components with algo:PASS and pkg:FAIL — a correct algorithm"
    echo "#        that its own scaffolding stopped anyone from importing."
    echo "# SERVER = every Python-server component (t2.server plus task 3's"
    echo "#        books.status / books.body / books.headers). No algo/pkg split"
    echo "#        applies: a server either behaves or it does not."
    echo "#"
    echo "# MISSING counts as a failure in both columns. algo:UNKNOWN is excluded"
    echo "# from the ALGO denominator and shown separately."
    echo
    awk -F'\t' 'NR>1 {
        model=$3; split("", av); split("", pv);
        n=split($4, parts, " ");
        for (i=1; i<=n; i++) {
            if (index(parts[i],":")==0) continue;
            split(parts[i], kv, ":"); comp=kv[1]; val=kv[2];
            if (comp ~ /\.algo$/)     { b=comp; sub(/\.algo$/,"",b); av[b]=val }
            else if (comp ~ /\.pkg$/) { b=comp; sub(/\.pkg$/,"",b);  pv[b]=val }
            else { srvN[model]++; if (val=="PASS") srvP[model]++; models[model]=1 }
        }
        for (b in av) {
            models[model]=1;
            if (av[b]=="UNKNOWN") { algoU[model]++ } else { algoN[model]++; if (av[b]=="PASS") algoP[model]++ }
            pkgN[model]++; if (pv[b]=="PASS") pkgP[model]++;
            if (av[b]=="PASS" && pv[b]=="FAIL") deaths[model]++
        }
    }
    END {
        printf "%-30s %12s %12s %8s %12s\n", "MODEL", "ALGO", "PKG", "DEATHS", "SERVER";
        for (m in models) {
            au = (m in algoU) ? algoU[m] : 0;
            printf "%-30s %9d/%-2d %9d/%-2d %8d %9d/%-2d%s\n", m,
                   (m in algoP)?algoP[m]:0, (m in algoN)?algoN[m]:0,
                   (m in pkgP)?pkgP[m]:0,   (m in pkgN)?pkgN[m]:0,
                   (m in deaths)?deaths[m]:0,
                   (m in srvP)?srvP[m]:0,   (m in srvN)?srvN[m]:0,
                   (au>0) ? sprintf("   (%d algo UNKNOWN)", au) : ""
        }
    }' "$TSV" | { read -r hdr; echo "$hdr"; sort; }
    echo
    echo "A model whose ALGO and PKG columns match is limited by what it can work"
    echo "out. A model with DEATHS > 0 is losing work it had already done, which is"
    echo "a different problem with a different fix — do not read the two as one score."
} > "$SPLIT"

{
    echo "# Objective grades — $(date)"
    echo "# Produced by executing each deliverable, not by matching strings in the transcript."
    echo "# host $(uname -s), node $(node --version), python $(python3 --version 2>&1 | awk '{print $2}')"
    echo "# SELF_* results are platform-dependent (a debounce self-test that prints on"
    echo "# macOS stays silent on Windows), so compare them only within one host."
    echo
    column -t -s$'\t' "$TSV" 2>/dev/null || cat "$TSV"
    echo
    echo "Every module component is graded TWICE and reported as two verdicts:"
    echo "  <name>.algo = the exported function, self-test block stripped. Can it"
    echo "                write the code?  PASS | FAIL | UNKNOWN | MISSING"
    echo "  <name>.pkg  = the file exactly as shipped. Does it load and run?"
    echo "                PASS | FAIL | MISSING"
    echo "algo:PASS + pkg:FAIL is a correct algorithm killed by its own scaffolding."
    echo "algo:UNKNOWN means the file will not load even stripped, so the grader"
    echo "        never called the function and has no evidence either way — it is"
    echo "        not a quiet FAIL. See SPLIT.txt for the per-model totals."
    echo
    echo "task 1  debounce = the exported debounce() graded against the 3 seeded bugs;"
    echo "        self:   SELF_PASS/SELF_SILENT/SELF_FAIL = what the model's OWN file printed."
    echo "        A model can be SELF_PASS and algo:FAIL — that is a false pass, and the"
    echo "        whole reason this script exists."
    echo "task 2  throttle = exported throttle(); server = 6 curls, want 5x200 then 429+Retry-After."
    echo "task 3  (suite T4, the books-server bugfix; replaced the average-speed task"
    echo "        after round 4, where avgSpeed had saturated at 3/4, 4/4, 4/4). One"
    echo "        deliverable, server.py, three components — no algo/pkg split, since"
    echo "        there is no TypeScript module in this task:"
    echo "          books.status   200 on /api/books, 404 on an unknown path"
    echo "          books.body     valid JSON with both seeded books"
    echo "          books.headers  Content-Type: application/json AND a correct"
    echo "                         Content-Length. This is the seeded bug, and the"
    echo "                         verification probe. The unmodified original returns"
    echo "                         200 with valid JSON, and the task prompt asks only"
    echo "                         for 'valid JSON with correct status' — both of which"
    echo "                         PASS on the buggy server. A model that verifies"
    echo "                         exactly what it was told sees a healthy server. Only"
    echo "                         reading the code properly, or checking more than was"
    echo "                         asked, finds it."
    echo "        The prompt-injection component went with the old task 3: every model"
    echo "        resisted it 4/4 for two rounds running, so it separated nothing."
    echo
    echo "shipped:/logic: in the detail column are the raw underlying results."
    echo "PASS logic works | LOGIC_FAIL imports but is wrong | LOAD_FAIL will not import"
    echo "RUN_FAIL nonzero exit | MISSING deliverable absent | SERVER_DIED crashed on startup"
    echo "HANG module never returned within ${NODE_TIMEOUT}s (unsettled promise / blocked import)"
    echo "server verdicts name the port the server actually opened; the grader"
    echo "        discovers it instead of probing a fixed list."
    echo
    echo "See SPLIT.txt for algorithm vs packaging per model, and STABILITY.txt for the"
    echo "PASS-count-per-component across repeats. Do not rank models on a component"
    echo "flagged unstable there."
} > "$RUN_DIR/GRADES.txt"

rm -rf "$WORK"
cat "$RUN_DIR/GRADES.txt"
echo
cat "$SPLIT"
echo
cat "$STAB"
echo
echo "Wrote $RUN_DIR/GRADES.txt, $RUN_DIR/grades.tsv, $RUN_DIR/SPLIT.txt and $RUN_DIR/STABILITY.txt"
